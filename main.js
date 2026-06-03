const io=new IntersectionObserver((es)=>{
  es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})
},{threshold:.15});
document.querySelectorAll('.reveal').forEach((el,i)=>{el.style.transitionDelay=(i%3*0.08)+'s';io.observe(el)});

const waitlistForm=document.getElementById('waitlistForm');
if(waitlistForm){
  const success=document.getElementById('waitlistSuccess');
  const errEl=document.getElementById('formError');
  const showError=(msg)=>{errEl.textContent=msg;errEl.hidden=false};
  waitlistForm.addEventListener('submit',(e)=>{
    e.preventDefault();
    errEl.hidden=true;
    const data={
      firstName:waitlistForm.firstName.value.trim(),
      lastName:waitlistForm.lastName.value.trim(),
      email:waitlistForm.email.value.trim().toLowerCase(),
      phone:waitlistForm.phone.value.trim(),
    };
    if(!data.firstName||!data.email){
      showError('Please enter your first name and email.');
      return;
    }
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)){
      showError('Please enter a valid email address.');
      return;
    }
    // TODO(backend): POST data to Supabase Edge Function (handled by Alex).
    console.log('[waitlist] signup',data);
    waitlistForm.hidden=true;
    success.hidden=false;
  });
}
