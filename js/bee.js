// The bee mascot. One inline SVG; the mood is a class on the wrapper:
// idle | happy | sad | listen | think. CSS shows the matching mouth/eyes and animation.
export function beeSVG() {
  return `
<svg class="bee" viewBox="0 0 120 110" aria-hidden="true">
  <g class="bee-wings">
    <ellipse class="wing wing-l" cx="44" cy="26" rx="18" ry="24" />
    <ellipse class="wing wing-r" cx="76" cy="26" rx="18" ry="24" />
  </g>
  <g class="bee-body">
    <ellipse cx="60" cy="64" rx="42" ry="36" fill="#ffc93c" stroke="#3a2a00" stroke-width="4" />
    <path d="M32 40 Q60 30 88 40 L92 50 Q60 40 28 50 Z" fill="#3a2a00" />
    <path d="M22 86 Q60 100 98 86 L94 94 Q60 106 26 94 Z" fill="#3a2a00" />
    <line x1="48" y1="30" x2="40" y2="12" stroke="#3a2a00" stroke-width="3" stroke-linecap="round" />
    <line x1="72" y1="30" x2="80" y2="12" stroke="#3a2a00" stroke-width="3" stroke-linecap="round" />
    <circle cx="40" cy="11" r="4" fill="#3a2a00" />
    <circle cx="80" cy="11" r="4" fill="#3a2a00" />
    <g class="eyes eyes-open">
      <circle cx="46" cy="60" r="7" fill="#3a2a00" /><circle cx="48" cy="58" r="2.2" fill="#fff" />
      <circle cx="74" cy="60" r="7" fill="#3a2a00" /><circle cx="76" cy="58" r="2.2" fill="#fff" />
    </g>
    <g class="eyes eyes-happy">
      <path d="M38 62 Q46 52 54 62" fill="none" stroke="#3a2a00" stroke-width="4" stroke-linecap="round" />
      <path d="M66 62 Q74 52 82 62" fill="none" stroke="#3a2a00" stroke-width="4" stroke-linecap="round" />
    </g>
    <g class="eyes eyes-up">
      <circle cx="46" cy="60" r="7" fill="#3a2a00" /><circle cx="47" cy="55.5" r="2.4" fill="#fff" />
      <circle cx="74" cy="60" r="7" fill="#3a2a00" /><circle cx="75" cy="55.5" r="2.4" fill="#fff" />
    </g>
    <circle cx="34" cy="74" r="5" fill="#ff8a65" opacity="0.55" />
    <circle cx="86" cy="74" r="5" fill="#ff8a65" opacity="0.55" />
    <path class="mouth mouth-idle" d="M52 76 Q60 82 68 76" fill="none" stroke="#3a2a00" stroke-width="3.5" stroke-linecap="round" />
    <path class="mouth mouth-happy" d="M48 73 Q60 90 72 73 Z" fill="#3a2a00" />
    <path class="mouth mouth-sad" d="M51 82 Q60 74 69 82" fill="none" stroke="#3a2a00" stroke-width="3.5" stroke-linecap="round" />
    <ellipse class="mouth mouth-listen" cx="60" cy="79" rx="5" ry="6" fill="#3a2a00" />
    <path class="mouth mouth-think" d="M53 79 L67 77" fill="none" stroke="#3a2a00" stroke-width="3.5" stroke-linecap="round" />
  </g>
</svg>`;
}

export function mountBee(el, mood = 'idle') {
  if (!el.firstElementChild) el.innerHTML = beeSVG();
  setMood(el, mood);
}

export function setMood(el, mood) {
  el.dataset.mood = mood;
  // Restart the one-shot animations (happy bounce, sad droop).
  el.classList.remove('bee-anim');
  void el.offsetWidth;
  el.classList.add('bee-anim');
}
