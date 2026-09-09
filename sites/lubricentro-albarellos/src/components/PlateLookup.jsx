import React, { useState } from 'react';
import { fetchVehicleByPlate, fetchVehicleHistoryPage, formatPlateDisplay } from '../services/plateService';
import { siteConfig } from '../data/siteConfig';
import {
  Search,
  Car,
  Calendar,
  Gauge,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  Clock,
  Wrench,
  MessageCircle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  ShieldAlert,
  Sparkles
} from 'lucide-react';

export default function PlateLookup() {
  const [inputPlate, setInputPlate] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [result, setResult] = useState(null);
  const [expandedHistory, setExpandedHistory] = useState(true);

  const handleSearch = async (e, plateToSearch = null) => {
    if (e) e.preventDefault();
    const query = plateToSearch !== null ? plateToSearch : inputPlate;
    if (!query.trim()) return;

    setLoading(true);
    setResult(null);
    setHistoryError('');

    const response = await fetchVehicleByPlate(query);
    setLoading(false);
    setResult(response);
  };

  // Helper para armar el mensaje de WhatsApp según el vehículo
  const getCustomWhatsAppLink = (vehicle) => {
    const recommendation = vehicle.recommendedNextKm
      ? ` Me figura una recomendación de service para los ${vehicle.recommendedNextKm.toLocaleString('es-AR')} km.`
      : '';
    const text = `Hola Lubricentro Albarellos! Consulté en la web por mi vehículo ${vehicle.brand} ${vehicle.model} (Patente ${vehicle.plate}).${recommendation} Quisiera coordinar un turno.`;
    return siteConfig.getWhatsAppLink(text);
  };

  const formatKm = (value) => value == null ? 'Sin registro' : `${value.toLocaleString('es-AR')} km`;

  const loadMoreHistory = async () => {
    if (!result?.success || !result.data.historyHasMore || result.data.historyNextOffset == null) return;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const page = await fetchVehicleHistoryPage(inputPlate, result.data.historyNextOffset);
      setResult((current) => ({
        ...current,
        data: {
          ...current.data,
          history: [...current.data.history, ...page.items],
          historyHasMore: page.hasMore,
          historyNextOffset: page.nextOffset
        }
      }));
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'No pudimos cargar más servicios.');
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <section id="consulta-patente" className="py-20 bg-[#0c0f16] relative border-b border-zinc-800">
      {/* Background accents */}
      <div className="absolute inset-0 bg-carbon opacity-60 pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-red-600/10 blur-[130px] rounded-full pointer-events-none" />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-950/60 border border-red-700/40 text-red-400 text-xs font-semibold uppercase tracking-wider mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Sistema Online de Clientes</span>
          </div>
          <h2 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold text-white tracking-wide">
            CONSULTÁ EL ESTADO DE <span className="text-red-500">TU VEHÍCULO</span>
          </h2>
          <p className="text-zinc-400 text-base sm:text-lg mt-3">
            Ingresá tu patente para ver los servicios realizados en nuestro taller, los insumos colocados y cuándo te recomendamos volver.
          </p>
        </div>

        {/* Search Plate Box */}
        <div className="max-w-xl mx-auto mb-12">
          <form onSubmit={(e) => handleSearch(e)} className="flex flex-col items-center">

            {/* Chapa Patente Estilizada */}
            <div className="w-full bg-zinc-900 p-2 sm:p-3 rounded-2xl border-2 border-red-900/40 shadow-2xl shadow-red-950/40">
              <div className="relative bg-white rounded-xl border-4 border-zinc-800 p-2 sm:p-3 shadow-inner">

                {/* Cuatro tornillos esquineros de la patente */}
                <div className="absolute top-2 left-2 w-2.5 h-2.5 rounded-full bg-zinc-400 border border-zinc-600 shadow-sm flex items-center justify-center">
                  <div className="w-1.5 h-0.5 bg-zinc-600 rotate-45" />
                </div>
                <div className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-zinc-400 border border-zinc-600 shadow-sm flex items-center justify-center">
                  <div className="w-1.5 h-0.5 bg-zinc-600 -rotate-45" />
                </div>
                <div className="absolute bottom-2 left-2 w-2.5 h-2.5 rounded-full bg-zinc-400 border border-zinc-600 shadow-sm flex items-center justify-center">
                  <div className="w-1.5 h-0.5 bg-zinc-600 -rotate-45" />
                </div>
                <div className="absolute bottom-2 right-2 w-2.5 h-2.5 rounded-full bg-zinc-400 border border-zinc-600 shadow-sm flex items-center justify-center">
                  <div className="w-1.5 h-0.5 bg-zinc-600 rotate-45" />
                </div>

                {/* Franja azul Mercosur */}
                <div className="bg-[#002f6c] text-white rounded-t-md px-3 py-1 flex items-center justify-between text-[11px] sm:text-xs font-bold tracking-widest uppercase">
                  <div className="flex items-center gap-1.5">
                    {/* Bandera argentina simplificada */}
                    <div className="w-4 h-2.5 bg-[#74acdf] border border-white/50 flex flex-col justify-between">
                      <div className="h-0.5 bg-[#74acdf]" />
                      <div className="h-0.5 bg-white" />
                      <div className="h-0.5 bg-[#74acdf]" />
                    </div>
                    <span>ARGENTINA</span>
                  </div>
                  <span className="text-[10px] text-yellow-300 font-semibold">MERCOSUR</span>
                </div>

                {/* Input de patente en el centro */}
                <div className="py-2 sm:py-3 px-2 flex items-center justify-center bg-zinc-50">
                  <input
                    type="text"
                    value={inputPlate}
                    onChange={(e) => setInputPlate(e.target.value.toUpperCase())}
                    placeholder="AA 123 AA"
                    maxLength={9}
                    className="w-full text-center font-heading text-3xl sm:text-4xl md:text-5xl font-black text-zinc-900 bg-transparent tracking-[0.2em] focus:outline-none uppercase placeholder:text-zinc-300"
                  />
                </div>
              </div>

              {/* Botón de búsqueda */}
              <div className="mt-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-red-600 via-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-bold text-base sm:text-lg flex items-center justify-center gap-2 shadow-lg shadow-red-950/80 transition active:scale-[0.99] disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Buscando en la base de datos...</span>
                    </>
                  ) : (
                    <>
                      <Search className="w-5 h-5" />
                      <span>Consultar Historial y Service</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>

        </div>

        {/* Result Area */}
        {result && result.success && (
          <div className="bg-[#11141c] rounded-2xl border border-zinc-800 overflow-hidden shadow-2xl transition-all duration-300 animate-fadeIn">

            {/* Header del Vehículo */}
            <div className="bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 p-6 border-b border-zinc-700/60 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start sm:items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-red-600/20 border border-red-500/40 flex items-center justify-center text-red-400 shrink-0">
                  <Car className="w-7 h-7" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2.5 py-0.5 rounded bg-zinc-800 font-mono font-bold text-sm tracking-wider text-white border border-zinc-700">
                      {result.data.plate}
                    </span>
                  </div>
                  <h3 className="font-heading text-2xl sm:text-3xl font-bold text-white mt-1">
                    {result.data.brand} {result.data.model}
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Año {result.data.year ?? 'Sin registro'}{result.data.engine ? ` • Motor ${result.data.engine}` : ''}
                  </p>
                </div>
              </div>

              {/* Botón de nueva búsqueda */}
              <button
                onClick={() => setResult(null)}
                className="self-start md:self-center flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium border border-zinc-700 transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Limpiar</span>
              </button>
            </div>

            {/* Banner de Estado y Semáforo */}
            <div className={`p-6 border-b ${
              result.data.status === 'ok'
                ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-300'
                : result.data.status === 'warning'
                ? 'bg-amber-950/30 border-amber-800/40 text-amber-300'
                : result.data.status === 'danger'
                ? 'bg-rose-950/30 border-rose-800/40 text-rose-300'
                : 'bg-zinc-900/60 border-zinc-700 text-zinc-300'
            }`}>
              <div className="flex items-start sm:items-center gap-3.5">
                {result.data.status === 'ok' ? (
                  <CheckCircle className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5 sm:mt-0" />
                ) : result.data.status === 'warning' ? (
                  <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
                ) : result.data.status === 'danger' ? (
                  <ShieldAlert className="w-6 h-6 text-rose-400 shrink-0 mt-0.5 sm:mt-0" />
                ) : (
                  <Clock className="w-6 h-6 text-zinc-400 shrink-0 mt-0.5 sm:mt-0" />
                )}
                <div>
                  <h4 className="font-heading text-lg sm:text-xl font-bold tracking-wide uppercase">
                    {result.data.statusLabel}
                  </h4>
                  <p className="text-sm opacity-90 mt-0.5">
                    {result.data.statusMessage}
                  </p>
                </div>
              </div>
            </div>

            {/* Fila de Datos Clave: Kilometrajes y Fechas */}
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-zinc-800 bg-zinc-900/60 p-5 text-center">
              <div className="p-3">
                <span className="text-xs text-zinc-400 uppercase tracking-wider flex items-center justify-center gap-1">
                  <Gauge className="w-3.5 h-3.5 text-red-500" />
                  Último Km Registrado
                </span>
                <p className="font-heading text-2xl font-bold text-white mt-1">
                  {formatKm(result.data.lastServiceKm)}
                </p>
                <span className="text-[11px] text-zinc-400">Fecha: {result.data.lastServiceDate}</span>
              </div>

              <div className="p-3">
                <span className="text-xs text-zinc-400 uppercase tracking-wider flex items-center justify-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-yellow-500" />
                  Kilometraje Actual Registrado
                </span>
                <p className="font-heading text-2xl font-bold text-yellow-400 mt-1">
                  {formatKm(result.data.currentMileage)}
                </p>
                <span className="text-[11px] text-zinc-400">Dato informado al taller</span>
              </div>

              <div className="p-3 bg-red-950/20 sm:rounded-r-lg">
                <span className="text-xs text-red-300 font-semibold uppercase tracking-wider flex items-center justify-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-red-400" />
                  Próximo Cambio Sugerido
                </span>
                <p className="font-heading text-2xl font-bold text-red-400 mt-1">
                  {formatKm(result.data.recommendedNextKm)}
                </p>
                <span className="text-[11px] text-red-300/80 font-medium">Fecha sugerida: {result.data.recommendedNextDate}</span>
              </div>
            </div>

            {/* Recomendaciones para el Próximo Service */}
            <div className="p-6 border-b border-zinc-800 bg-[#0e1118]">
              <h4 className="font-heading text-lg font-bold text-white flex items-center gap-2 mb-4">
                <Wrench className="w-5 h-5 text-red-500" />
                PRÓXIMO MANTENIMIENTO
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
                {result.data.upcomingTasks.map((task) => (
                  <div key={task.id} className="flex items-center justify-between p-3 rounded-xl bg-zinc-900/80 border border-zinc-800">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-2 h-2 rounded-full ${
                        task.priority === 'urgente' ? 'bg-rose-500 animate-ping' :
                        task.priority === 'alta' ? 'bg-amber-400' : 'bg-blue-400'
                      }`} />
                      <span className="text-sm font-medium text-zinc-200">{task.item}</span>
                    </div>
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                      task.priority === 'urgente' ? 'bg-rose-500/20 text-rose-300' :
                      task.priority === 'alta' ? 'bg-amber-500/20 text-amber-300' : 'bg-zinc-800 text-zinc-400'
                    }`}>
                      {task.priority}
                    </span>
                  </div>
                ))}
                {!result.data.upcomingTasks.length && (
                  <p className="text-sm text-zinc-400 md:col-span-2">
                    Para calcular una fecha y un kilometraje sugeridos primero necesitamos registrar un servicio.
                  </p>
                )}
              </div>

              {/* CTA directo de agendamiento para esta patente */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-xl bg-gradient-to-r from-red-950/40 via-red-900/30 to-zinc-900 border border-red-700/50">
                <div>
                  <p className="font-heading text-base font-bold text-white">¿Querés agendar este servicio ahora?</p>
                  <p className="text-xs text-zinc-300">Enviamos automáticamente los datos de tu patente para darte presupuesto exacto y reservar tu horario.</p>
                </div>
                <a
                  href={getCustomWhatsAppLink(result.data)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-950/60 transition shrink-0"
                >
                  <MessageCircle className="w-4 h-4 fill-current" />
                  <span>Coordinar por WhatsApp</span>
                </a>
              </div>
            </div>

            {/* Historial de Intervenciones Previas */}
            <div className="p-6">
              <button
                onClick={() => setExpandedHistory(!expandedHistory)}
                className="w-full flex items-center justify-between text-left py-2 font-heading text-lg font-bold text-white hover:text-red-400 transition"
              >
                <span className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-red-500" />
                  HISTORIAL DE SERVICIOS EN LUBRICENTRO ALBARELLOS ({result.data.history.length})
                </span>
                {expandedHistory ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </button>

              {expandedHistory && (
                <div className="mt-6 space-y-6">
                  {!result.data.history.length && (
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5 text-sm text-zinc-400">
                      Todavía no hay servicios registrados para esta patente.
                    </div>
                  )}
                  {result.data.history.map((srv) => (
                    <div key={srv.id} className="relative pl-6 sm:pl-8 pb-6 border-l-2 border-red-900/50 last:border-l-transparent last:pb-0">
                      {/* Círculo del timeline */}
                      <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-red-600 border-2 border-zinc-900" />

                      <div className="bg-zinc-900/90 rounded-xl p-4 sm:p-5 border border-zinc-800">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-3 mb-3">
                          <div>
                            <span className="text-xs font-bold text-red-400 uppercase tracking-wider">{srv.serviceType}</span>
                            <h5 className="font-heading text-lg font-bold text-white">{srv.summary}</h5>
                          </div>
                          <div className="text-left sm:text-right">
                            <span className="inline-block px-2.5 py-0.5 rounded bg-zinc-800 text-zinc-200 font-mono text-xs font-bold">
                              {srv.km}
                            </span>
                            <p className="text-[11px] text-zinc-400 mt-0.5">{srv.date}</p>
                          </div>
                        </div>

                        {/* Insumos Colocados */}
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-zinc-300 mb-2">Insumos y Repuestos Instalados:</p>
                          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-zinc-300">
                            {srv.items.map((it, i) => (
                              <li key={i} className="flex items-center justify-between p-2 rounded bg-zinc-950/60 border border-zinc-800/80">
                                <span>{it.name}</span>
                                <span className="text-zinc-400 font-mono text-[11px] ml-2">{it.qty}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                      </div>
                    </div>
                  ))}
                  {historyError && <p className="text-sm text-rose-300 text-center">{historyError}</p>}
                  {result.data.historyHasMore && (
                    <button
                      type="button"
                      onClick={loadMoreHistory}
                      disabled={historyLoading}
                      className="mx-auto flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-5 py-3 text-sm font-bold text-white transition hover:bg-zinc-700 disabled:opacity-60"
                    >
                      {historyLoading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                      {historyLoading ? 'Cargando servicios...' : 'Ver 10 servicios anteriores'}
                    </button>
                  )}
                </div>
              )}
            </div>

          </div>
        )}

        {/* Not Found State */}
        {result && result.notFound && (
          <div className="bg-zinc-900/90 rounded-2xl border border-zinc-800 p-8 text-center max-w-lg mx-auto animate-fadeIn">
            <div className="w-14 h-14 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center mx-auto mb-4 text-zinc-400">
              <AlertCircle className="w-7 h-7" />
            </div>
            <h3 className="font-heading text-xl font-bold text-white mb-2">
              Patente no registrada en el sistema
            </h3>
            <p className="text-sm text-zinc-400 mb-6">
              No encontramos registros para la patente <strong className="text-white font-mono">{formatPlateDisplay(result.searchedPlate)}</strong>. Si hiciste un service recientemente o es tu primera vez en nuestro taller, podemos darte el alta y coordinar tu visita.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => setResult(null)}
                className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium transition"
              >
                Buscar otra patente
              </button>
              <a
                href={siteConfig.getWhatsAppLink(`Hola Lubricentro Albarellos! Consulté en la web por la patente ${result.searchedPlate} y no la encontré en el sistema. Quisiera consultar por un turno.`)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-md transition"
              >
                <MessageCircle className="w-4 h-4" />
                Consultar por WhatsApp
              </a>
            </div>
          </div>
        )}

        {result && !result.success && !result.notFound && (
          <div className="bg-rose-950/30 rounded-2xl border border-rose-800/50 p-6 text-center max-w-lg mx-auto animate-fadeIn">
            <AlertTriangle className="w-7 h-7 text-rose-400 mx-auto mb-3" />
            <p className="text-sm text-rose-100">{result.error}</p>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="mt-4 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm font-medium transition"
            >
              Corregir patente
            </button>
          </div>
        )}

      </div>
    </section>
  );
}
