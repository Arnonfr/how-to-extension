import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8');
function setup({ authenticated = true, recipes = [], queryError = null, blocked = false, currentUrl = 'https://example.invalid/recipe' } = {}) {
  const calls = { imports: 0, bodies: [], upserts: 0, created: [], updated: [], scripts: [] };
  const session = authenticated ? { user: { id: 'owner', email: 'test@example.invalid' } } : null;
  const recipe = { id: 'test-recipe', title: 'Test recipe', source: { url: 'https://example.invalid/recipe' }, chapters: [{ text: 'Mix' }] };
  const query = {
    select() { return this; }, eq() { return this; },
    then(resolve) { return Promise.resolve({ data: recipes.map(recipe => ({recipe})), error: queryError }).then(resolve); },
    maybeSingle: async () => ({ data: recipes[0] ? { recipe: recipes[0] } : null, error: queryError }),
    upsert: async ({ recipe }) => { calls.upserts++; recipes.push(recipe); return { error: null }; },
  };
  const context = vm.createContext({
    importScripts() {}, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    fetch: async (_url, options) => { calls.imports++; calls.bodies.push(JSON.parse(options.body)); await new Promise(r => setTimeout(r, 5)); if (blocked && calls.imports === 1) return {ok:false,status:400,json:async()=>({error:'No recipe text could be read'})}; return { ok: true, status: 200, json: async () => ({recipe}) }; },
    supabase: { createClient: () => ({ auth: { getSession: async () => ({data:{session}}) }, from: () => query }) },
    chrome: { storage: {local:{}}, runtime: {onMessage:{addListener(){}}},
      tabs: {create:async data=>{calls.created.push(data);return {id:9};}, get:async()=>({status:'complete',url:currentUrl}),
        onUpdated:{addListener(){},removeListener(){}}, update:async(id,data)=>calls.updated.push({id,...data}), remove:async()=>{}},
      scripting:{executeScript:async data=>{calls.scripts.push(data);return [{result:'Recipe ingredients and instructions. '.repeat(30)}];}},
    },
  });
  vm.runInContext(source, context);
  return {api: vm.runInContext('({saveOnce,stateForPage,openRecipe})', context), calls, recipe};
}
test('signed-out save makes no import or database write', async()=>{
 const {api,calls}=setup({authenticated:false});assert.equal((await api.saveOnce('https://example.invalid/recipe')).error,'auth');assert.equal(calls.imports,0);assert.equal(calls.upserts,0);
});
test('concurrent saves share one import; reopen resolves saved recipe',async()=>{
 const {api,calls}=setup();const [first,second,state]=await Promise.all([api.saveOnce('https://example.invalid/recipe'),api.saveOnce('https://example.invalid/recipe'),api.stateForPage('https://example.invalid/recipe')]);
 assert.equal(first.saved.id,second.saved.id);assert.equal(calls.imports,1);assert.equal(calls.upserts,1);
 assert.equal((await api.stateForPage('https://example.invalid/recipe')).saved.id,'test-recipe');
});
test('existing recipe skips import and upsert',async()=>{
 const saved={id:'existing',source:{url:'https://example.invalid/recipe'}};const {api,calls}=setup({recipes:[saved]});
 const result=await api.saveOnce('https://example.invalid/recipe');assert.equal(result.duplicate,true);assert.equal(result.saved.id,'existing');assert.equal(calls.imports,0);assert.equal(calls.upserts,0);
});
test('failed library check keeps account identity, and does not import blindly',async()=>{
 const {api,calls}=setup({queryError:new Error('offline')});const state=await api.stateForPage('https://example.invalid/recipe');assert.equal(state.email,'test@example.invalid');assert.match(state.error,/Could not check/);
 await assert.rejects(api.saveOnce('https://example.invalid/recipe'),/Could not check/);assert.equal(calls.imports,0);
});
test('internal and non-web URLs cannot be imported',async()=>{
 const {api,calls}=setup();await assert.rejects(api.saveOnce('chrome://extensions'),/Open a recipe/);await assert.rejects(api.saveOnce('javascript:alert(1)'),/Open a recipe/);assert.equal(calls.imports,0);
});
test('open checks ownership and transfers only recipe to web cache, no OAuth token',async()=>{
 const saved={id:'test-recipe',title:'Test'};const {api,calls}=setup({recipes:[saved]});assert.equal((await api.openRecipe('test-recipe')).opened,true);
 assert.equal(calls.created[0].active,false);assert.equal(calls.created[0].url,'https://howto-liart.vercel.app/import.html');
 assert.equal(calls.scripts[0].args[0].id,'test-recipe');assert.equal(calls.updated[0].url,'https://howto-liart.vercel.app/?v=test-recipe');assert.equal(calls.updated[0].active,true);
});
test('open refuses invalid or no-longer-saved IDs',async()=>{
 const {api,calls}=setup();await assert.rejects(api.openRecipe('../../x'),/cannot be opened/);await assert.rejects(api.openRecipe('missing'),/Could not find/);assert.equal(calls.created.length,0);
});

test('v0.3 tab text fallback remains available when server reading fails',async()=>{
 const {api,calls}=setup({blocked:true});const result=await api.saveOnce('https://example.invalid/recipe',99);assert.equal(result.saved.id,'test-recipe');assert.equal(calls.imports,2);assert.equal(calls.bodies[1].mode,'text');assert.equal(calls.bodies[1].sourceUrl,'https://example.invalid/recipe');assert.equal(calls.upserts,1);
});
test('fallback never reads an unrelated page after the tab navigates',async()=>{
 const {api,calls}=setup({blocked:true,currentUrl:'https://example.invalid/private'});await assert.rejects(api.saveOnce('https://example.invalid/recipe',99),/No recipe text/);assert.equal(calls.imports,1);assert.equal(calls.scripts.length,0);assert.equal(calls.upserts,0);
});
