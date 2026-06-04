const io=new IntersectionObserver((es)=>{
  es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})
},{threshold:.15});
document.querySelectorAll('.reveal').forEach((el,i)=>{el.style.transitionDelay=(i%3*0.08)+'s';io.observe(el)});

const WAITLIST_ENDPOINT='https://cbgmxppoazlujdzefgss.supabase.co/functions/v1/join-waitlist';

const waitlistForm=document.getElementById('waitlistForm');
if(waitlistForm){
  const errEl=document.getElementById('formError');
  const submitBtn=waitlistForm.querySelector('button[type="submit"]');
  const showError=(msg)=>{errEl.textContent=msg;errEl.hidden=false};
  waitlistForm.addEventListener('submit',async(e)=>{
    e.preventDefault();
    errEl.hidden=true;
    const data={
      firstName:waitlistForm.firstName.value.trim(),
      lastName:waitlistForm.lastName.value.trim(),
      email:waitlistForm.email.value.trim().toLowerCase(),
      phone:waitlistForm.phone.value.trim(),
      company:waitlistForm.company.value.trim(), // honeypot — real users leave blank
    };
    if(!data.firstName||!data.email){
      showError('Please enter your first name and email.');
      return;
    }
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)){
      showError('Please enter a valid email address.');
      return;
    }
    const origLabel=submitBtn?submitBtn.textContent:'';
    if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='Joining…';}
    try{
      const res=await fetch(WAITLIST_ENDPOINT,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(data),
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok||!body.ok){
        showError(body.error||'Something went wrong. Please try again.');
        if(submitBtn){submitBtn.disabled=false;submitBtn.textContent=origLabel;}
        return;
      }
      // Redirect to the tracked thank-you page so DataFast records the conversion.
      window.location.href='/joined';
      return;
    }catch{
      showError('Network error. Please check your connection and try again.');
      if(submitBtn){submitBtn.disabled=false;submitBtn.textContent=origLabel;}
    }
  });
}
