document.querySelectorAll('.back-to-top a[href="#top"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    const instant = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: instant ? 'auto' : 'smooth' });
  });
});
