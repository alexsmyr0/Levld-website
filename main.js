const io=new IntersectionObserver((es)=>{
  es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})
},{threshold:.15});
document.querySelectorAll('.reveal').forEach((el,i)=>{el.style.transitionDelay=(i%3*0.08)+'s';io.observe(el)});
