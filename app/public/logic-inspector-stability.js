(()=>{
'use strict';
if(location.pathname!=='/'&&location.pathname!=='/index.html')return;

const scrollByContext=new Map();
let lastBody=null;
let focusState=null;
let restoreToken=0;

function selectedContext(){
  if(state?.view!=='logic')return'';
  const node=document.querySelector('.logic-integrated .node.selected[data-node]')?.dataset.node||'';
  const tab=document.querySelector('.logic-integrated [data-logic-tab].active')?.dataset.logicTab||'inspector';
  const edge=document.querySelector('.logic-integrated .edge.selected')?'edge':'';
  return`${tab}|${node||edge||'none'}`;
}

function sideBody(){return document.querySelector('.logic-integrated .logic-side-body')}

function rememberScroll(body=sideBody()){
  if(!body)return;
  const key=selectedContext();
  if(key)scrollByContext.set(key,body.scrollTop);
}

function controlToken(element){
  if(!(element instanceof HTMLElement)||!element.closest('.logic-side-body'))return null;
  const attr=[...element.attributes].find(a=>/^data-(?:lq|ls|lstart|goi)-/.test(a.name));
  if(!attr)return null;
  const body=element.closest('.logic-side-body');
  const selector=`[${CSS.escape(attr.name)}]`;
  const index=[...body.querySelectorAll(selector)].indexOf(element);
  if(index<0)return null;
  let start=null,end=null;
  try{if(typeof element.selectionStart==='number'){start=element.selectionStart;end=element.selectionEnd}}catch{}
  return{key:selectedContext(),attr:attr.name,index,start,end};
}

function rememberFocus(element=document.activeElement){
  const token=controlToken(element);
  if(token)focusState=token;
}

function restoreForBody(body,token){
  if(!body||body!==lastBody||token!==restoreToken||state?.view!=='logic')return;
  const key=selectedContext();
  const saved=scrollByContext.get(key);
  if(Number.isFinite(saved))body.scrollTop=Math.max(0,Math.min(saved,Math.max(0,body.scrollHeight-body.clientHeight)));
  if(focusState?.key===key){
    const selector=`[${CSS.escape(focusState.attr)}]`;
    const target=body.querySelectorAll(selector)[focusState.index];
    if(target instanceof HTMLElement){
      try{target.focus({preventScroll:true})}catch{try{target.focus()}catch{}}
      if(focusState.start!==null&&typeof target.setSelectionRange==='function'){
        try{target.setSelectionRange(focusState.start,focusState.end??focusState.start)}catch{}
      }
    }
  }
}

function detectNewBody(){
  if(state?.view!=='logic')return;
  const body=sideBody();
  if(!body||body===lastBody)return;
  lastBody=body;
  const token=++restoreToken;
  requestAnimationFrame(()=>requestAnimationFrame(()=>restoreForBody(body,token)));
  setTimeout(()=>restoreForBody(body,token),60);
}

document.addEventListener('scroll',event=>{
  const target=event.target;
  if(target instanceof HTMLElement&&target.matches('.logic-integrated .logic-side-body'))rememberScroll(target);
},true);

document.addEventListener('focusin',event=>rememberFocus(event.target),true);
document.addEventListener('input',event=>rememberFocus(event.target),true);
document.addEventListener('change',event=>{rememberScroll();rememberFocus(event.target)},true);
document.addEventListener('click',event=>{
  if(event.target.closest?.('.logic-side-body'))rememberScroll();
},true);

const root=document.getElementById('app')||document.body;
new MutationObserver(detectNewBody).observe(root,{childList:true,subtree:true});
queueMicrotask(detectNewBody);
})();
