import{l as p,p as m}from"./index.5858d4b2.js";import{d as v,j as u,o as f,m as o,q as a,s as e,C as r,A as c,u as d,e as y,M as g,x as _}from"./index.3b3943fc.js";const x={key:0,class:"content"},k={class:"box"},w=e("p",{class:"logo"},null,-1),C=e("p",null,"Query results:",-1),b={key:0,class:"red"},N={key:1,class:"white"},S=_(" Dear consumers:"),q=e("br",null,null,-1),V=_(" What you inquired and verified is the genuine ELUX product! "),B=[S,q,V],T=e("span",{class:"button"},[e("a",{style:{color:"white"},href:"https://www.eluxtech.com/"},"Visit the official website")],-1),D={key:1,class:"fake"},E=e("p",null,"THIS PRODUCT IS FAKE!",-1),O=v({name:"[id]",setup(A){const s=u("1"),n=u(""),l=g().params.id,h=async(i="")=>{m("api/eluxSearch/query",{searchNumber:i}).then(t=>{console.log(t.data.cc=="0"),t.data.cc=="0"?(s.value=t.data.times,n.value=t.data.firstQueryTime):(n.value="",s.value="1")})};return f(()=>{console.log(l),console.log("1111"),h(l)}),(i,t)=>s.value>0&&s.value<=20?(o(),a("div",x,[e("div",k,[w,C,e("p",null,[s.value>=11?(o(),a("span",b,"Warning!Code scanding times have exceeded the maximun limit! Bevare of counterfeiring!")):r("",!0),s.value>0&&s.value<10?(o(),a("span",N,B)):r("",!0)]),e("p",null," First query time: "+c(n.value),1),e("p",null," Number of queries: "+c(s.value),1),e("p",null," Security passeword: "+c(d(l)),1)]),T])):(o(),a("div",D,[y(d(p),{class:"ps-icon"}),E]))}});export{O as default};
