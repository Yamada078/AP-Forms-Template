(()=>{
'use strict';

function questionContexts(form){
  const out=[];
  const scanOptions=(options,section,parentQuestion)=>{for(const option of options||[]){scanBlocks(option.blocks||[],section,parentQuestion,option);scanOptions(option.children||[],section,parentQuestion)}};
  const scanBlocks=(blocks,section,parentQuestion=null,parentOption=null)=>{for(let index=0;index<(blocks||[]).length;index++){const block=blocks[index];if(block?.type!=='question')continue;out.push({block,list:blocks,index,section,parentQuestion,parentOption});scanOptions(block.options||[],section,block)}};
  for(const section of form?.sections||[])scanBlocks(section.blocks||[],section);
  return out;
}

function questionContext(form,id){return questionContexts(form).find(context=>context.block.id===id)||null}
function nestedQuestionIds(question,out=new Set()){if(!question?.id||out.has(question.id))return out;out.add(question.id);const walk=options=>{for(const option of options||[]){for(const block of option.blocks||[])if(block?.type==='question')nestedQuestionIds(block,out);walk(option.children||[])}};walk(question.options||[]);return out}

function moveSection(form,sectionId,targetIndex){
  const sections=form?.sections;if(!Array.isArray(sections))return{changed:false,error:'invalid_form'};
  const sourceIndex=sections.findIndex(section=>section.id===sectionId);if(sourceIndex<0)return{changed:false,error:'section_not_found'};
  const finalIndex=Math.max(0,Math.min(sections.length-1,Number(targetIndex)||0));if(finalIndex===sourceIndex)return{changed:false,index:sourceIndex};
  const [section]=sections.splice(sourceIndex,1);sections.splice(Math.max(0,Math.min(sections.length,finalIndex)),0,section);return{changed:true,index:sections.indexOf(section),section};
}

function moveQuestion(form,questionId,targetSectionId,targetQuestionId='',placement='before'){
  const source=questionContext(form,questionId),targetSection=form?.sections?.find(section=>section.id===targetSectionId);
  if(!source||!targetSection)return{changed:false,error:!source?'question_not_found':'target_section_not_found'};
  if(targetQuestionId===questionId)return{changed:false,error:'same_question'};
  const descendants=nestedQuestionIds(source.block);if(targetQuestionId&&descendants.has(targetQuestionId))return{changed:false,error:'cannot_move_into_descendant'};
  const target=targetQuestionId?questionContext(form,targetQuestionId):null;
  if(targetQuestionId&&(!target||target.section.id!==targetSection.id))return{changed:false,error:'target_question_not_found'};
  const targetList=target?.list||targetSection.blocks||(targetSection.blocks=[]);
  let insertIndex=target?target.index+(placement==='after'?1:0):targetList.length;
  if(source.list===targetList&&source.index<insertIndex)insertIndex-=1;
  source.list.splice(source.index,1);insertIndex=Math.max(0,Math.min(targetList.length,insertIndex));targetList.splice(insertIndex,0,source.block);
  if(source.section.id!==targetSection.id){
    const movedRules=(source.section.routingRules||[]).filter(rule=>rule.questionId===questionId);
    source.section.routingRules=(source.section.routingRules||[]).filter(rule=>rule.questionId!==questionId);
    if(movedRules.length){targetSection.routingRules||(targetSection.routingRules=[]);for(const rule of movedRules)if(!targetSection.routingRules.includes(rule))targetSection.routingRules.push(rule)}
  }
  return{changed:true,question:source.block,sourceSection:source.section,targetSection,index:insertIndex};
}

globalThis.GOI_LOGIC_STRUCTURE_MODEL=Object.freeze({questionContexts,questionContext,nestedQuestionIds,moveSection,moveQuestion});
})();
