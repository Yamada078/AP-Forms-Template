
function __apText(value) { return globalThis.APFormsI18n ? globalThis.APFormsI18n.text(value) : value; }
function __apHtml(strings, ...values) { return globalThis.APFormsI18n ? globalThis.APFormsI18n.html(strings, ...values) : strings.reduce((result, part, index) => result + part + (index < values.length ? String(values[index] ?? '') : ''), ''); }
function __apLabels(value) { return globalThis.APFormsI18n ? globalThis.APFormsI18n.labels(value) : value; }
export const flattenOptions=(options,out=[])=>{for(const option of options||[]){out.push(option);flattenOptions(option.children,out)}return out};

export function collectQuestions(section){
  const out=[];
  const scanOptions=(options,parentQuestion)=>{for(const option of options||[]){scanBlocks(option.blocks||[],parentQuestion,option);scanOptions(option.children,parentQuestion)}};
  const scanBlocks=(blocks,parentQuestion=null,parentOption=null)=>{for(const block of blocks||[]){if(block.type==='question'){out.push({block,parentQuestion,parentOption});scanOptions(block.options,block)}}};
  scanBlocks(section?.blocks||[]);return out;
}

export function allQuestions(form){const out=[];for(const section of form?.sections||[])for(const ctx of collectQuestions(section))out.push({section,...ctx});return out}
export const questionContext=(form,id)=>allQuestions(form).find(item=>item.block.id===id)||null;
export const questionById=(form,id)=>questionContext(form,id)?.block||null;
export const sectionById=(form,id)=>form?.sections?.find(section=>section.id===id)||null;
export function operatorLabel(operator,value,value2=''){const ops={equals:'=',not_equals:'≠',contains:'contains',one_of:'one of',not_one_of:'not one of',gte:'≥',lte:'≤',between:'between'};return`${ops[operator]||operator||'='} ${String(value??'')}${operator==='between'?` – ${String(value2??'')}`:''}`.trim()}
export function conditionLabel(form,condition){if(!condition?.enabled)return __apText('ไม่มี');const source=questionById(form,condition.questionId);return`${source?.title||__apText('คำถามที่ไม่พบ')} ${operatorLabel(condition.operator,condition.value,condition.value2)}`}

const autoPos=(kind,si=0,qi=0,total=1)=>kind==='start'?{x:70,y:95}:kind==='end'?{x:370+Math.max(1,total)*430,y:95}:kind==='section'?{x:350+si*430,y:95}:{x:320+si*430,y:225+qi*165};

export function buildGraph(form,layout={}){
  const nodes=[],edges=[],nodeMap=new Map(),qContexts=new Map(),sections=form?.sections||[];
  const add=node=>{const saved=layout[node.id];node.pos=saved&&Number.isFinite(+saved.x)&&Number.isFinite(+saved.y)?{x:+saved.x,y:+saved.y}:node.auto;nodes.push(node);nodeMap.set(node.id,node)};
  add({id:'start',kind:'start',title:'START',subtitle:form?.startPage?.title||'Respondent Info',auto:autoPos('start',0,0,sections.length)});
  sections.forEach((section,si)=>{
    add({id:`sec:${section.id}`,kind:'section',sectionId:section.id,title:section.title||`Section ${si+1}`,subtitle:`PAGE ${si+1}`,auto:autoPos('section',si,0,sections.length)});
    collectQuestions(section).forEach((ctx,qi)=>{qContexts.set(ctx.block.id,{section,sectionIndex:si,questionIndex:qi,...ctx});add({id:`q:${ctx.block.id}`,kind:'question',sectionId:section.id,questionId:ctx.block.id,title:ctx.block.title||__apText('คำถาม'),subtitle:ctx.block.questionType||'question',question:ctx.block,parentQuestion:ctx.parentQuestion,parentOption:ctx.parentOption,auto:autoPos('question',si,qi,sections.length)})});
  });
  add({id:'end',kind:'end',title:'END',subtitle:'Submit',auto:autoPos('end',0,0,sections.length)});
  if(sections[0])edges.push({id:'flow:start',kind:'flow',source:'start',target:`sec:${sections[0].id}`,label:__apText('เริ่ม')});else edges.push({id:'flow:start-end',kind:'flow',source:'start',target:'end',label:'submit'});
  sections.forEach((section,si)=>{
    const top=(section.blocks||[]).filter(block=>block.type==='question'),fallback=sections[si+1]?`sec:${sections[si+1].id}`:'end';
    if(top.length){edges.push({id:`flow:${section.id}:first`,kind:'flow',source:`sec:${section.id}`,target:`q:${top[0].id}`,label:__apText('เริ่มหน้า')});top.forEach((q,qi)=>edges.push({id:`flow:${section.id}:${q.id}`,kind:'flow',source:`q:${q.id}`,target:top[qi+1]?`q:${top[qi+1].id}`:fallback,label:top[qi+1]?'next':__apText('จบหน้า')}))}else edges.push({id:`flow:${section.id}:empty`,kind:'flow',source:`sec:${section.id}`,target:fallback,label:'next'});
    (section.routingRules||[]).forEach((rule,ri)=>{if(rule.questionId&&rule.targetSectionId)edges.push({id:`route:${section.id}:${ri}`,kind:'route',source:`q:${rule.questionId}`,target:`sec:${rule.targetSectionId}`,label:operatorLabel(rule.operator,rule.value,rule.value2),sourceSectionId:section.id,ruleIndex:ri,questionId:rule.questionId,value:rule.value,operator:rule.operator})});
  });
  for(const [qid,ctx] of qContexts){
    const q=ctx.block;
    if(q.condition?.enabled&&q.condition.questionId)edges.push({id:`condition:${qid}`,kind:'condition',source:`q:${q.condition.questionId}`,target:`q:${qid}`,label:operatorLabel(q.condition.operator,q.condition.value,q.condition.value2),targetQuestionId:qid,value:q.condition.value,operator:q.condition.operator});
    const walk=options=>{for(const option of options||[]){const scan=blocks=>{for(const block of blocks||[]){if(block.type==='question'){edges.push({id:`option:${qid}:${option.id}:${block.id}`,kind:'option',source:`q:${qid}`,target:`q:${block.id}`,label:option.label||__apText('ตัวเลือก'),optionId:option.id});for(const childOption of block.options||[])scan(childOption.blocks||[])}}};scan(option.blocks||[]);walk(option.children)}};walk(q.options||[]);
  }
  return{nodes,edges,nodeMap,qContexts};
}

export function diagnostics(form){
  const messages=[],sections=form?.sections||[],secIds=new Set(sections.map(s=>s.id)),qIds=new Set(allQuestions(form).map(item=>item.block.id));
  for(const section of sections){
    for(const rule of section.routingRules||[]){if(rule.questionId&&!qIds.has(rule.questionId))messages.push(__apHtml`Page Routing ใน “${section.title}” อ้างถึงคำถามที่ไม่มีอยู่`);if(rule.targetSectionId&&!secIds.has(rule.targetSectionId))messages.push(__apHtml`Page Routing ใน “${section.title}” ชี้ไป Section ที่ไม่มีอยู่`)}
    for(const {block} of collectQuestions(section))if(block.condition?.enabled&&block.condition.questionId&&!qIds.has(block.condition.questionId))messages.push(__apHtml`Conditional ของ “${block.title||__apText('คำถาม')}” อ้างถึงคำถามที่ไม่มีอยู่`);
  }
  if(!sections.length)return messages;
  const adj=new Map(sections.map((s,i)=>[s.id,new Set(sections[i+1]?[sections[i+1].id]:[])]));
  for(const section of sections)for(const rule of section.routingRules||[])if(secIds.has(rule.targetSectionId))adj.get(section.id).add(rule.targetSectionId);
  const reached=new Set(),walk=id=>{if(reached.has(id))return;reached.add(id);for(const next of adj.get(id)||[])walk(next)};walk(sections[0].id);
  for(const section of sections)if(!reached.has(section.id))messages.push(__apHtml`Section “${section.title}” ไม่มีเส้นทางเข้าจาก START`);
  let cycle=false;const visiting=new Set(),done=new Set();const dfs=id=>{if(visiting.has(id)){cycle=true;return}if(done.has(id))return;visiting.add(id);for(const next of adj.get(id)||[])dfs(next);visiting.delete(id);done.add(id)};dfs(sections[0].id);if(cycle)messages.push(__apText('พบเส้นทาง Section ที่สามารถวนกลับเป็น Loop ได้'));
  return messages;
}
