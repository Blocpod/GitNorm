'use client';

import { useState } from 'react';

export default function ShareButton({title,text}:{title:string;text:string}){
  const [label,setLabel]=useState('↗ Share');
  async function share(){
    try{
      if(navigator.share){await navigator.share({title,text,url:location.href});return;}
      await navigator.clipboard.writeText(location.href);
      setLabel('✓ Link copied');
      setTimeout(()=>setLabel('↗ Share'),2500);
    }catch{setLabel('Copy this page’s address');setTimeout(()=>setLabel('↗ Share'),2500)}
  }
  return <button type="button" className="secondary-button" onClick={()=>void share()} aria-live="polite">{label}</button>;
}
