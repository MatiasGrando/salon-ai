import React, {useEffect, useState} from 'react';
import {ArrowLeft, ArrowRight, Check, MapPin} from 'lucide-react';
import {BRANCHES} from '../data/glowData';
import {branchFromSearch, safeBookingDestination} from '../data/glowBooking';
import {useBranchCatalog} from './BranchCatalog';

function SedeOption({branch, selected, choose}) {
  const catalog = useBranchCatalog(branch.id);
  return <button type="button" aria-pressed={selected} onClick={() => choose(branch.id)} className={`booking-sede ${selected ? 'booking-sede-active' : ''}`}>
    <span className="booking-sede-heading"><MapPin size={20}/><strong>{branch.name}</strong>{selected && <Check size={20}/>}</span>
    <span className="booking-address">{catalog.status === 'ready' ? catalog.address || 'Dirección no publicada' : catalog.status === 'error' ? 'No pudimos verificar esta sede' : 'Cargando dirección…'}</span>
    {selected && <span className="booking-selected-label">Sede seleccionada</span>}
  </button>;
}

export default function BookingGateway() {
  const [branch, setBranch] = useState(() => branchFromSearch(window.location.search));
  const catalog = useBranchCatalog(branch);
  const destination = safeBookingDestination(catalog,branch);
  useEffect(() => { document.title = 'Elegí tu sede | Glow Peluquería'; },[]);
  const choose = id => {
    setBranch(id);
    // Keep only branch context; old service, professional and redirect parameters are discarded.
    window.history.replaceState(null,'',`/reservar?sede=${id}`);
  };
  return <main className="glow-booking-gateway">
    <div className="booking-container">
      <header className="booking-brand"><a href="/" aria-label="Volver a Glow">GLOW<span>PELUQUERÍA</span></a><span>Reserva online</span></header>
      <section className="booking-panel" aria-labelledby="booking-heading">
        <a className="booking-back" href="/"><ArrowLeft size={16}/> Volver a la landing</a>
        <p className="booking-step">SEDE → SERVICIO → PROFESIONAL → HORARIO → CONFIRMAR</p>
        <h1 id="booking-heading">Elegí tu sede</h1>
        <p className="booking-intro">¿Dónde querés atenderte? Confirmá el local antes de ver sus servicios y turnos disponibles.</p>
        <div className="booking-options" role="group" aria-label="Sedes de Glow">{Object.values(BRANCHES).map(item => <SedeOption key={item.id} branch={item} selected={branch === item.id} choose={choose}/>)}</div>
        <div className="booking-context" aria-live="polite">
          {!branch ? 'Seleccioná una sede para continuar.' : destination ? <>Vas a reservar en <strong>Glow · {BRANCHES[branch].name}</strong><span>{catalog.address}</span></> : catalog.status === 'error' ? <>No pudimos cargar esta sede. <button type="button" onClick={catalog.retry}>Reintentar</button></> : catalog.status === 'loading' ? 'Verificando la sede seleccionada…' : 'La reserva de esta sede no está disponible. Podés elegir otro local.'}
        </div>
        <button type="button" className="booking-continue" disabled={!destination} onClick={() => destination && window.location.assign(destination)}>Continuar a reservas <ArrowRight size={18}/></button>
        <p className="booking-note">Los servicios, profesionales y horarios corresponden únicamente al local que elijas.</p>
      </section>
    </div>
  </main>;
}
