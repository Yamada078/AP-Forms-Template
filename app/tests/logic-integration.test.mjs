import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');

test('integrated Logic is in-place and does not reconnect collaboration', async () => {
  const [bootstrap, toggle, finalize, safety, inspectorStability] = await Promise.all([
    read('public/logic-bootstrap.js'),
    read('public/logic-mode-toggle.js'),
    read('public/logic-v2-finalize.js'),
    read('public/logic-v2-safety.js'),
    read('public/logic-inspector-stability.js'),
  ]);
  const combined = `${bootstrap}\n${toggle}\n${finalize}\n${safety}\n${inspectorStability}`;
  assert.match(combined, /state\.view\s*=\s*['"]logic['"]/);
  assert.match(combined, /goiLogicModeBtn/);
  assert.match(combined, /preview\.before\(/);
  assert.doesNotMatch(combined, /location\.(?:href|assign|replace)\s*=/);
  assert.doesNotMatch(combined, /\bconnectCollab\s*\(/);
  assert.doesNotMatch(combined, /\bdisconnectCollab\s*\(/);
});

test('Logic CSS is scoped and cannot lock Responses scrolling', async () => {
  const css = await read('public/logic.css');
  assert.match(css, /^\.logic-integrated/);
  assert.doesNotMatch(css, /(^|[},\n])\s*(?:html|body|html\s*,\s*body)\s*\{/m);
  for (const selector of ['workspace', 'inspector', 'node', 'viewport']) {
    assert.match(css, new RegExp(`\\.logic-integrated \\.${selector}`));
    assert.doesNotMatch(css, new RegExp(`(^|[}\\n])\\s*\\.${selector}\\s*\\{`, 'm'));
  }
});

test('Logic editor covers production form schema', async () => {
  const [toggle, finalize] = await Promise.all([read('public/logic-mode-toggle.js'), read('public/logic-v2-finalize.js')]);
  const combined = `${toggle}\n${finalize}`;
  for (const token of ['rating_matrix', 'radar', 'Respondent Fields', 'Page Routing', 'Conditional Display', 'Hidden score']) assert.match(combined, new RegExp(token));
});

test('Worker installs Builder bridge before public/login early returns', async () => {
  const [entry, html] = await Promise.all([read('src/entry.js'), read('public/index.html')]);
  const fnStart = entry.indexOf('function injectCoreBridge');
  const fnEnd = entry.indexOf('function logicLoaderTag');
  assert.ok(fnStart >= 0 && fnEnd > fnStart, 'injectCoreBridge source must be extractable');
  const injectCoreBridge = Function(`${entry.slice(fnStart, fnEnd)}; return injectCoreBridge;`)();
  const injected = injectCoreBridge(html);
  const bridgePos = injected.indexOf('window.GOI_FORMS_CORE_BRIDGE = true;');
  const publicReturnPos = injected.indexOf('if(publicFormId){loadPublic(publicFormId);return}');
  const authReturnPos = injected.indexOf('if(!state.token||!state.memberName){renderLogin();return}');
  assert.ok(bridgePos > 0, 'bridge must be present in served Builder HTML');
  assert.ok(publicReturnPos > bridgePos, 'bridge must run before public-form early return');
  assert.ok(authReturnPos > bridgePos, 'bridge must run before login early return');
  assert.match(injected, /window\.state\s*=\s*state;/);
  assert.match(injected, /window\.renderAdmin\s*=\s*function/);
  assert.match(entry, /data-goi-logic-loader/);
  assert.match(entry, /!window\.GOI_FORMS_CORE_BRIDGE\s*\|\|\s*!window\.state/);
  assert.match(entry, /logic-bootstrap\.js\?v=4\.3\.3/);
  assert.match(entry, /logic-mode-toggle\.js\?v=4\.3\.3/);
  assert.match(entry, /logic-v2-finalize\.js\?v=4\.3\.3/);
  assert.match(entry, /logic-v2-safety\.js\?v=4\.3\.5/);
  assert.match(entry, /logic-inspector-stability\.js\?v=4\.3\.6/);
  assert.match(entry, /logic-structure-model\.js\?v=4\.4\.0/);
  assert.match(entry, /logic-structural-drag\.js\?v=4\.4\.0/);
  assert.match(entry, /5\.2\.1-question-pack-foundation/);
  assert.match(entry, /export class FormRoom extends BaseFormRoom/);
  assert.doesNotMatch(entry, /DROP\s+TABLE|DELETE\s+FROM/i);
});

test('structural model reorders pages without replacing IDs or routing targets', async () => {
  const source=await read('public/logic-structure-model.js'),context={};context.globalThis=context;vm.runInNewContext(source,context);
  const api=context.GOI_LOGIC_STRUCTURE_MODEL,form={sections:[
    {id:'page_1',blocks:[],routingRules:[{questionId:'q1',targetSectionId:'page_3'}]},
    {id:'page_2',blocks:[],routingRules:[]},
    {id:'page_3',blocks:[],routingRules:[]},
  ]};
  const result=api.moveSection(form,'page_3',1);
  assert.equal(result.changed,true);assert.deepEqual(form.sections.map(section=>section.id),['page_1','page_3','page_2']);
  assert.equal(form.sections[0].routingRules[0].targetSectionId,'page_3');
});

test('question structural moves preserve presentation blocks, IDs, conditions and move routing ownership', async () => {
  const source=await read('public/logic-structure-model.js'),context={};context.globalThis=context;vm.runInNewContext(source,context);const api=context.GOI_LOGIC_STRUCTURE_MODEL;
  const heading={id:'heading',type:'heading'},text={id:'text',type:'text'},panel={id:'panel',type:'panel'},q1={id:'q1',type:'question'},q2={id:'q2',type:'question'},q3={id:'q3',type:'question',condition:{enabled:true,questionId:'q1'}};
  const form={sections:[{id:'page_1',blocks:[heading,q1,text,q2,q3],routingRules:[{questionId:'q3',targetSectionId:'page_2'}]},{id:'page_2',blocks:[panel],routingRules:[]}]};
  assert.equal(api.moveQuestion(form,'q3','page_1','q2','before').changed,true);
  assert.deepEqual(form.sections[0].blocks.map(block=>block.id),['heading','q1','text','q3','q2']);
  assert.equal(q3.condition.questionId,'q1');
  assert.equal(api.moveQuestion(form,'q3','page_2').changed,true);
  assert.deepEqual(form.sections[0].blocks.map(block=>block.id),['heading','q1','text','q2']);
  assert.deepEqual(form.sections[1].blocks.map(block=>block.id),['panel','q3']);
  assert.equal(form.sections[1].routingRules[0].questionId,'q3');assert.equal(form.sections[1].routingRules[0].targetSectionId,'page_2');
});

test('Canvas UX exposes centered spawn, collision avoidance and explicit structure mode without persistent page frames', async () => {
  const ux=await read('public/logic-structural-drag.js'),css=await read('public/logic.css');
  for(const token of ['worldMetrics','freeSlot','seedInitialLayout','placeUnpositionedNodes','logicStructureMode','Structure Move: ON','moveQuestion','moveSection','selectedNodeId','cleanupLayout'])assert.match(ux,new RegExp(token));
  assert.match(ux,/if\(!editable\(\)\)return/);assert.match(ux,/event\.stopImmediatePropagation\(\)/);assert.match(ux,/markDirty/);assert.match(ux,/renderAdmin/);
  assert.doesNotMatch(css,/logic-page-lane/);for(const token of ['goi-structure-dragging','logic-structure-indicator','structure-mode','viewer-structure-locked'])assert.match(css,new RegExp(token));
});

test('safe delete cleans nested question references', async () => {
  const safety = await read('public/logic-v2-safety.js');
  assert.match(safety, /nestedQuestionIds/);
  assert.match(safety, /cleanReferences/);
  assert.match(safety, /stopImmediatePropagation/);
});

test('Logic safety tolerates empty selection without questionType crash', async () => {
  const safety = await read('public/logic-v2-safety.js');
  assert.match(safety, /if\(!id\)return null/);
  assert.match(safety, /if\(!id\)return;const ctx=findQuestion\(id\)/);
  assert.doesNotMatch(safety, /ctx=id&&findQuestion\(id\)/);
  assert.doesNotMatch(safety, /ctx\?\.block\.questionType/);
});

test('END Page Routing replaces the ghost sec:END edge before paint', async () => {
  const safety = await read('public/logic-v2-safety.js');
  assert.match(safety, /targetSectionId!=='END'/);
  assert.match(safety, /data-goi-end-route/);
  assert.match(safety, /data-goi-end-ghost/);
  assert.match(safety, /ghost\.remove\(\)/);
  assert.match(safety, /records\.every\(ownEndMutation\)/);
  assert.doesNotMatch(safety, /requestAnimationFrame\(\(\)=>\{pending=false;try\{patchEndRoutes/);
});

test('Node drag overlay removes the visible zero wall and coarse 10px snap', async () => {
  const safety = await read('public/logic-v2-safety.js'),bootstrap=await read('public/logic-bootstrap.js');
  assert.match(safety, /data-goi-drag-ux/);
  assert.match(safety, /min-height:50px/);
  assert.match(bootstrap, /goi_logic_layout:/);
  assert.match(bootstrap, /removeAllRanges/);
  assert.match(bootstrap, /x\.preventDefault\(\)/);
  assert.match(bootstrap, /drawEdges\(\);drawMinimap\(\)/);
  assert.match(bootstrap, /goiSuppressClick/);
  assert.match(bootstrap, /Math\.round\(\(bx\+\(x\.clientX-sx\)\/graphUi\.zoom\)\*10\)\/10/);
  assert.doesNotMatch(bootstrap, /const nx=Math\.max\(0,/);
  assert.doesNotMatch(bootstrap, /\/10\)\*10/);
});

test('Logic inspector preserves scroll and active editor control across rerenders', async () => {
  const stability = await read('public/logic-inspector-stability.js');
  assert.match(stability, /const scrollByContext=new Map\(\)/);
  assert.match(stability, /logic-side-body/);
  assert.match(stability, /scrollByContext\.set\(key,body\.scrollTop\)/);
  assert.match(stability, /body\.scrollTop=Math\.max/);
  assert.match(stability, /selectedContext\(\)/);
  assert.match(stability, /data-logic-tab/);
  assert.match(stability, /focus\(\{preventScroll:true\}\)/);
  assert.match(stability, /setSelectionRange/);
  assert.match(stability, /requestAnimationFrame\(\(\)=>requestAnimationFrame/);
  assert.doesNotMatch(stability, /renderLogic\s*\(/);
  assert.doesNotMatch(stability, /renderAdmin\s*\(/);
});
