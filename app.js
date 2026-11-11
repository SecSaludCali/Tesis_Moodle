let dashboardData = {}; let cursosPorBase = {}; let cursoActual = null; let datosFiltradosActuales = null; 
let chartInstances = {}; let promediosGlobalesPreguntas = {}; let mapInstance = null; let geoJsonDataRaw = null; 
let geoJsonLayer = null; let añosDisponibles = new Set(); let añoActual = "ALL"; let filterDebounceTimer = null;

let paginaComunasActual = 0;
const ITEMS_POR_PAGINA_COMUNAS = 10;
let dataComunasCache = null;

const mapeoPreguntas = { 
    "¿Se dio a conocer el objetivo de la capacitación?": "Objetivo Claro", "¿Se cumplió el objetivo de la capacitación?": "Obj. Cumplido", 
    "¿Los contenidos brindados fueron coherentes con el objetivo planteado?": "Coherencia", "¿Los temas se desarrollaron en el tiempo previsto?": "Tiempo", 
    "¿La capacitación aportó nuevos conceptos y/o técnicas que antes no conocía?": "Aporte Nuevo", "¿Los conocimientos recibidos durante la capacitación le permitirán llevarlos a la práctica en su vida cotidiana?": "Práctica", 
    "¿La metodología utilizada por el facilitador permitió el entendimiento de los contenidos?": "Metodología", "¿El facilitador demostró el dominio del tema brindado?": "Dominio Docente", 
    "¿Durante el desarrollo de la capacitación se propició la participación de los asistentes?": "Participación", "¿Durante la capacitación se dio espacio para la solución de inquietudes?": "Inquietudes", 
    "¿Cómo califica las condiciones del espacio físico o medio virtual en el que se desarrolló la capacitación?": "UX Virtual", "¿El material utilizado permitió el entendimiento del tema?": "Material", 
    "En general, ¿Cómo se sintió con la actividad de capacitación realizada?": "Satisfacción (eNPS)" 
};

const mapeoColores = {
    "Femenino": "#e11d48", "Masculino": "#0ea5e9", "N/A": "#94a3b8", "Otro": "#8b5cf6",
    "Primera infancia": "#f43f5e", "Infancia": "#f97316", "Adolescencia": "#eab308", "Juventud": "#84cc16", "Adultez": "#06b6d4", "Vejez": "#6366f1",
    "Médico": "#05cd99", "Enfermera": "#4318ff", "Auxiliar": "#ffb547", "Estudiante": "#ee5d50", "Área de la salud": "#05cd99",
    "Profesional": "#3b82f6", "Técnico": "#10b981", "Tecnólogo": "#14b8a6", "Especialización": "#8b5cf6", "Maestría": "#6366f1", "Postgrado": "#8b5cf6", "Pregrado": "#3b82f6", "Bachiller": "#f59e0b", "Ninguna": "#94a3b8"
};
const coloresRespaldo = ['#4318ff', '#05cd99', '#ffb547', '#ee5d50', '#0ea5e9', '#8b5cf6', '#14b8a6', '#f43f5e', '#f97316'];

const centerTextPlugin = {
    id: 'centerText',
    beforeDraw(chart) {
        if (chart.config.type !== 'doughnut') return;
        const { width, height, ctx } = chart;
        ctx.restore();
        const total = chart.data.datasets[0].data.reduce((a, b) => a + (Number(b) || 0), 0);
        const fontSize = (height / 5).toFixed(2);
        ctx.font = `800 ${fontSize}px Inter`;
        ctx.textBaseline = "middle";
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-main');
        const text = total.toLocaleString();
        const textX = Math.round((width - ctx.measureText(text).width) / 2);
        const textY = height / 2;
        ctx.fillText(text, textX, textY);
        ctx.save();
    }
};
Chart.register(centerTextPlugin);

function formatoDiasHoras(diasDecimal) {
    if (!diasDecimal || isNaN(diasDecimal)) return "0D 0H";
    let d = Math.floor(diasDecimal);
    let h = Math.round((diasDecimal - d) * 24);
    if (h >= 24) { d += 1; h -= 24; }
    return `${d}D ${h}H`;
}

function getIconForLabel(label, filterType) {
    const l = String(label).toLowerCase();
    
    if (filterType === 'f-edad') {
        if(l.includes('primera')) return 'bi-emoji-smile';
        if(l.includes('infancia')) return 'bi-balloon';
        if(l.includes('adolescencia')) return 'bi-headphones';
        if(l.includes('juventud')) return 'bi-person-arms-up'; 
        if(l.includes('adultez')) return 'bi-briefcase';
        if(l.includes('vejez')) return 'bi-eyeglasses'; 
        return 'bi-person-circle';
    }
    
    if (filterType === 'f-escolaridad') {
        if(l.includes('bachiller')) return 'bi-book';
        if(l.includes('pregrado') || l.includes('profesional')) return 'bi-mortarboard-fill';
        if(l.includes('postgrado') || l.includes('maestr') || l.includes('especializaci')) return 'bi-award-fill';
        if(l.includes('técni') || l.includes('tecnólo')) return 'bi-tools';
        if(l.includes('ninguna')) return 'bi-circle';
        return 'bi-record-circle';
    }
    
    if (filterType === 'f-perfil') {
        if(l === 'otro' || l === 'otra') return 'bi-circle';
        if(l.includes('médico') || l.includes('salud') || l.includes('enfermer') || l.includes('auxiliar')) return 'bi-heart-pulse-fill';
        if(l.includes('estudiante')) return 'bi-pencil';
        return 'bi-person-badge';
    }

    if (filterType === 'f-sexo') {
        if(l.includes('femenino')) return 'bi-gender-female';
        if(l.includes('masculino')) return 'bi-gender-male';
        return 'bi-circle';
    }
    
    return 'bi-record-circle';
}

function triggerCrossFilter(filterId, value) {
    const selectEl = document.getElementById(filterId);
    if(selectEl) {
        if(selectEl.value === String(value)) selectEl.value = 'ALL';
        else selectEl.value = String(value);
        aplicarFiltrosDebounced();
    }
}

function switchView(viewId, element) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active-view'));
    document.getElementById(viewId).classList.add('active-view');
    document.querySelectorAll('.nav-item-custom').forEach(el => el.classList.remove('active'));
    if(element) element.classList.add('active');
    
    if(viewId === 'dashboard_view') {
        setTimeout(() => {
            if(mapInstance) {
                mapInstance.invalidateSize();
                if(geoJsonLayer && geoJsonLayer.getBounds().isValid()) {
                    mapInstance.fitBounds(geoJsonLayer.getBounds(), {padding: [10, 10]});
                }
            }
            for(let id in chartInstances) { if(chartInstances[id]) chartInstances[id].resize(); }
        }, 100);
    }
}

function toggleMobileMenu() { 
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('mobile-open'); 
    if(sidebar.classList.contains('mobile-open')){
        document.body.classList.add('menu-open');
    } else {
        document.body.classList.remove('menu-open');
    }
}

document.addEventListener('click', function(event) {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.querySelector('.mobile-toggle');
    if (sidebar.classList.contains('mobile-open') && !sidebar.contains(event.target) && !toggleBtn.contains(event.target)) {
        toggleMobileMenu();
    }
});

function cambiarTema(tema) {
    document.documentElement.setAttribute('data-theme', tema); localStorage.setItem('temaDashboard', tema);
    document.querySelectorAll('.theme-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll(`.theme-btn[data-theme-btn="${tema}"]`).forEach(b => b.classList.add('active'));
    Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--text-main');
    for (let id in chartInstances) { if (chartInstances[id]) { chartInstances[id].options.color = Chart.defaults.color; chartInstances[id].update('none'); } }
    if (mapInstance && mapInstance.lastDataComunas) { dibujarMapaCoropletico(mapInstance.lastDataComunas); }
}

window.descargarGrafico = function(canvasId, nombre) {
    const canvasOriginal = document.getElementById(canvasId);
    if (!canvasOriginal) return;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvasOriginal.width; tempCanvas.height = canvasOriginal.height;
    const ctx = tempCanvas.getContext('2d');
    
    const temaActual = document.documentElement.getAttribute('data-theme') || 'light';
    let bgColor = '#ffffff';
    if(temaActual === 'dark') bgColor = '#0b1437';
    else if(temaActual === 'rose') bgColor = '#fff1f2';
    else if(temaActual === 'amber') bgColor = '#fffbeb';
    else bgColor = '#f4f7fe';
    
    ctx.fillStyle = bgColor; ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    ctx.drawImage(canvasOriginal, 0, 0);
    
    const link = document.createElement('a');
    let sufijo = cursoActual ? `_${cursoActual.Nombre_Curso.substring(0,10)}` : '_Global';
    link.download = `${nombre}${sufijo}.png`;
    link.href = tempCanvas.toDataURL('image/png'); link.click();
};

function cargarFiltrosOLAP() {
    let registros = cursoActual ? cursoActual.Registros_Crudos : dashboardData.cursos.flatMap(c => c.Registros_Crudos || []);
    if(!registros || registros.length === 0) { document.getElementById('filtros-cruzados-bar').style.display = 'none'; return; }
    document.getElementById('filtros-cruzados-bar').style.display = 'flex';
    const fSexo = new Set(), fEdad = new Set(), fPerf = new Set(), fCom = new Set();
    registros.forEach(r => { 
        fSexo.add(String(r['Sexo']||"N/A").trim()); 
        fEdad.add(String(r['Curso de vida']||"N/A").trim()); 
        fPerf.add(String(r['Perfil']||"N/A").trim()); 
        let cu = String(r['Comuna_Unificada']||"N/A").trim();
        let cID = cu.replace(/\D/g, ''); cID = cID ? cID : cu;
        fCom.add(cID); 
    });
    const setOpts = (id, set, lbl) => { const el = document.getElementById(id); el.innerHTML = `<option value="ALL">${lbl}</option>`; Array.from(set).sort().forEach(v => { if(v && v!=="N/A") el.appendChild(new Option(v, v)); }); el.classList.remove('active-chip'); };
    setOpts('f-sexo', fSexo, 'Sexo'); setOpts('f-edad', fEdad, 'Edad'); setOpts('f-perfil', fPerf, 'Perfil'); setOpts('f-comuna', fCom, 'Comuna');
}

function aplicarFiltrosDebounced() {
    ['f-sexo', 'f-edad', 'f-perfil', 'f-comuna'].forEach(id => { const el = document.getElementById(id); if(el.value !== "ALL") el.classList.add('active-chip'); else el.classList.remove('active-chip'); });
    clearTimeout(filterDebounceTimer); filterDebounceTimer = setTimeout(aplicarFiltrosReal, 200);
}

function toggleVisibilidad(id, dataObj) {
    let el = document.getElementById(id);
    if(!el) return;
    let tieneDatos = dataObj && Object.values(dataObj).reduce((a,b) => a + parseFloat(b||0), 0) > 0;
    if(tieneDatos) el.style.display = ''; else el.style.display = 'none';
}

function aplicarFiltrosReal() {
    const vS = document.getElementById('f-sexo').value, vE = document.getElementById('f-edad').value, vP = document.getElementById('f-perfil').value, vC = document.getElementById('f-comuna').value;
    const esFiltrado = (vS!=="ALL" || vE!=="ALL" || vP!=="ALL" || vC!=="ALL");

    const moodleTab = document.getElementById('moodle-tab'); const radarTab = document.getElementById('radar-tab'); const lockIcon = document.getElementById('lock-icon');

    if(!esFiltrado) {
        datosFiltradosActuales = null; document.getElementById('kpi-moodle-row').classList.remove('filtro-lock'); document.getElementById('moodle-charts-wrapper').classList.remove('filtro-lock');
        moodleTab.classList.remove('locked'); moodleTab.setAttribute('data-bs-toggle', 'tab'); lockIcon.classList.add('d-none'); 
        if(cursoActual) actualizarPantallaCurso(null);
        else actualizarPantallaGlobal(null);
        return;
    }

    document.getElementById('kpi-moodle-row').classList.add('filtro-lock'); document.getElementById('moodle-charts-wrapper').classList.add('filtro-lock');
    moodleTab.classList.add('locked'); moodleTab.removeAttribute('data-bs-toggle'); lockIcon.classList.remove('d-none');
    if(moodleTab.classList.contains('active')) { let tab = new bootstrap.Tab(radarTab); tab.show(); document.querySelectorAll('.tab-clean').forEach(t => t.classList.remove('active')); radarTab.classList.add('active'); }

    let cursosFuente = cursoActual ? [cursoActual] : dashboardData.cursos;
    if (!cursoActual && añoActual !== "ALL") {
        cursosFuente = cursosFuente.filter(c => (c.Edicion||"").includes(añoActual));
    }

    let arrF = [];
    cursosFuente.forEach(c => {
        if(c.Registros_Crudos) {
            arrF = arrF.concat(c.Registros_Crudos.filter(r => {
                let s = String(r['Sexo']||"N/A").trim();
                let e = String(r['Curso de vida']||"N/A").trim();
                let pf = String(r['Perfil']||"N/A").trim();
                let cu = String(r['Comuna_Unificada']||"N/A").trim();
                let cID = cu.replace(/\D/g, ''); cID = cID ? cID : cu;
                return (vS==="ALL" || s===vS) && (vE==="ALL" || e===vE) && (vP==="ALL" || pf===vP) && (vC==="ALL" || cID===vC);
            }));
        }
    });
    
    let nD = { 'Sexo':{}, 'Edad':{}, 'Perfil':{}, 'Comuna':{}, 'Escolaridad':{} }; let sumQ = {}; let cQ = arrF.length; let p = 0, d = 0;
    arrF.forEach(r => {
        let s = String(r['Sexo'] || "N/A").trim(); nD.Sexo[s] = (nD.Sexo[s]||0) + 1;
        let e = String(r['Curso de vida'] || "N/A").trim(); nD.Edad[e] = (nD.Edad[e]||0) + 1;
        let pf = String(r['Perfil'] || "N/A").trim(); nD.Perfil[pf] = (nD.Perfil[pf]||0) + 1;
        let cu = String(r['Comuna_Unificada'] || "N/A").trim();
        let cid = cu.replace(/\D/g, ''); cid = cid ? cid : cu;
        nD.Comuna[cid] = (nD.Comuna[cid]||0) + 1;
        let esc = String(r['Escolaridad'] || "N/A").trim(); nD.Escolaridad[esc] = (nD.Escolaridad[esc]||0) + 1;

        Object.keys(mapeoPreguntas).forEach(q => { sumQ[q]=(sumQ[q]||0)+(parseFloat(r[q])||0); });
        let vg = parseFloat(r['En general, ¿Cómo se sintió con la actividad de capacitación realizada?'])||0; if(vg===5) p++; else if(vg<=3 && vg>0) d++;
    });
    datosFiltradosActuales = { Total_Encuestas: cQ, e_NPS: cQ>0?Math.round(((p-d)/cQ)*100,1):0, Demografia: nD, Detalle_Preguntas: (()=>{let n={}; Object.keys(sumQ).forEach(q=>n[q]=cQ>0?(sumQ[q]/cQ):0); return n})(), isFiltered: true };
    
    if (cursoActual) actualizarPantallaCurso(datosFiltradosActuales);
    else actualizarPantallaGlobal(datosFiltradosActuales);
}
function limpiarFiltros() { ['f-sexo', 'f-edad', 'f-perfil', 'f-comuna'].forEach(id => { document.getElementById(id).value = 'ALL'; document.getElementById(id).classList.remove('active-chip');}); aplicarFiltrosReal(); };

function inicializarMapa() { 
if (typeof L === 'undefined') return; 

if (!mapInstance) {
    mapInstance = L.map('map-container', {
        zoomControl: true,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: true
    }).setView([3.42158, -76.5205], 11);

    let resetControl = L.control({position: 'topleft'});
    resetControl.onAdd = function (map) {
        let div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
        div.innerHTML = '<a href="#" title="Centrar Mapa" style="display:flex; justify-content:center; align-items:center; color:var(--primary); font-size:1.1rem; text-decoration:none;"><i class="bi bi-arrows-collapse"></i></a>';
        div.onclick = function(e){
            e.preventDefault();
            if(geoJsonLayer && geoJsonLayer.getBounds().isValid()) {
                mapInstance.fitBounds(geoJsonLayer.getBounds(), {padding: [10, 10]});
            }
        }
        return div;
    };
    resetControl.addTo(mapInstance);
}

if(geoJsonDataRaw && !mapInstance.hasLoadedGeoJson) {
    mapInstance.hasLoadedGeoJson = true;

    if (typeof proj4 !== 'undefined') {
        proj4.defs("EPSG:3115", "+proj=tmerc +lat_0=4.596200416666666 +lon_0=-77.07750791666666 +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");
        proj4.defs("EPSG:9377", "+proj=tmerc +lat_0=4.0 +lon_0=-73.0 +k=0.9992 +x_0=5000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");
    }
    
    geoJsonLayer = L.geoJSON(geoJsonDataRaw, {
        coordsToLatLng: function (coords) {
            let x = coords[0];
            let y = coords[1];

            if (Math.abs(x) <= 180 && Math.abs(y) <= 90) {
                if (x > 0 && y < 0) return new L.LatLng(x, y); 
                return new L.LatLng(y, x); 
            }

            if (typeof proj4 !== 'undefined') {
                try {
                    if (x > 800000 && x < 1500000) {
                        let wgs = proj4("EPSG:3115", "EPSG:4326", [x, y]);
                        return new L.LatLng(wgs[1], wgs[0]);
                    } else if (x > 3000000 && x < 6000000) {
                        let wgs = proj4("EPSG:9377", "EPSG:4326", [x, y]);
                        return new L.LatLng(wgs[1], wgs[0]);
                    }
                } catch(e) {}
            }
            return new L.LatLng(3.42158, -76.5205); 
        },
        style: function(feature) {
            let defaultColor = document.documentElement.getAttribute('data-theme') === 'dark' ? '#1e293b' : '#e2e8f0';
            return {
                fillColor: defaultColor, 
                weight: 1, 
                opacity: 1,
                color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#334155' : '#cbd5e1',
                fillOpacity: 0.2
            };
        },
        onEachFeature: function(feature, layer) {
            let propComuna = feature.properties.comuna || feature.properties.COMUNA || feature.properties.nombre || feature.properties.id || "N/A";
            let id = String(propComuna).replace(/\D/g, ''); id = isNaN(parseInt(id,10)) ? String(propComuna) : String(parseInt(id,10)); 
            let nombreDisplay = isNaN(parseInt(id,10)) ? propComuna : "Comuna " + id;
            
            layer.bindTooltip('', { className: 'leaflet-tooltip-premium', sticky: true, direction: 'top', offset: [0, -10] });

            layer.on('mouseover', function(e) {
                layer.bringToFront(); 
                
                layer.setStyle({ weight: 3, color: '#ffffff', fillOpacity: 0.95 });
                if(layer._path) layer._path.style.filter = "drop-shadow(0px 0px 10px var(--primary))";
                
                let valor = mapInstance.lastDataComunas ? (mapInstance.lastDataComunas[id] || 0) : 0;
                layer.setTooltipContent(`<div style="text-align: center;"><span style="font-size: 0.7rem; color: #cbd5e1; text-transform: uppercase; letter-spacing: 1px;">${nombreDisplay}</span><br><strong style="font-size: 1.3rem; font-weight: 800; color: #fff;">${valor.toLocaleString()}</strong><span style="font-size: 0.8rem; font-weight: 400; color: #94a3b8; margin-left: 4px;">participantes</span></div>`);
            });
            
            layer.on('mouseout', function(e) {
                if (mapInstance.lastDataComunas) {
                    let p = mapInstance.lastDataComunas[id] || 0;
                    let maxP = mapInstance.lastMaxP || 1;
                    
                    let defaultColor = document.documentElement.getAttribute('data-theme') === 'dark' ? '#1e293b' : '#e2e8f0';
                    let defStroke = document.documentElement.getAttribute('data-theme') === 'dark' ? '#334155' : '#cbd5e1';
                    
                    layer.setStyle({
                        fillColor: p > 0 ? getColorMapa(p, maxP) : defaultColor,
                        fillOpacity: p > 0 ? 0.85 : 0.2,
                        weight: p > 0 ? 1.5 : 1,
                        color: p > 0 ? '#ffffff' : defStroke
                    });

                    if(layer._path && p > 0) {
                        layer._path.style.filter = "drop-shadow(0px 0px 4px rgba(67, 24, 255, 0.4))";
                    } else if (layer._path) {
                        layer._path.style.filter = "none";
                    }
                } else {
                    geoJsonLayer.resetStyle(layer);
                    if(layer._path) layer._path.style.filter = "none";
                }
            });
            
            layer.on('click', function(e) {
                triggerCrossFilter('f-comuna', id);
            });
        }
    }).addTo(mapInstance);
    
    if (geoJsonDataRaw.features && geoJsonDataRaw.features.length > 0) {
        if (document.getElementById('map-container').offsetWidth > 0 && geoJsonLayer.getBounds().isValid()) {
            mapInstance.fitBounds(geoJsonLayer.getBounds(), {padding: [10, 10]});
        }
    }
    
    if (mapInstance.lastDataComunas) {
        dibujarMapaCoropletico(mapInstance.lastDataComunas);
    }
}
}

function getColorMapa(v, max) { 
if(v===0) return document.documentElement.getAttribute('data-theme') === 'dark' ? '#1e293b' : '#e2e8f0'; 

let cOceanic = ['#bae6fd', '#7dd3fc', '#38bdf8', '#0284c7', '#0369a1']; 
let cRose = ['#ffe4e6','#fda4af','#fb7185','#e11d48','#be123c'];
let cAmber = ['#fef3c7','#fde047','#f59e0b','#d97706','#b45309'];
let cDark = ['#312e81', '#4338ca', '#4f46e5', '#6366f1', '#818cf8']; 

let t = document.documentElement.getAttribute('data-theme');
let c = t==='rose' ? cRose : t==='amber' ? cAmber : t==='dark' ? cDark : cOceanic; 

if(v>max*0.8) return c[4]; if(v>max*0.6) return c[3]; if(v>max*0.4) return c[2]; if(v>max*0.2) return c[1]; return c[0]; 
}

function dibujarMapaCoropletico(dataComunas) { 
    if (!mapInstance || !geoJsonLayer) return; 
    
    let mapNorm = {}; let maxP = 0; 
    for (let n in dataComunas) { 
        let id = String(n||"N/A").replace(/\D/g, ''); 
        id = isNaN(parseInt(id,10)) ? String(n).trim() : String(parseInt(id,10)); 
        mapNorm[id] = (mapNorm[id]||0) + (dataComunas[n]||0); 
        if(mapNorm[id] > maxP && !isNaN(id)) maxP = mapNorm[id]; 
    } 
    
    mapInstance.lastDataComunas = mapNorm;
    mapInstance.lastMaxP = maxP; 
    const defaultColor = document.documentElement.getAttribute('data-theme') === 'dark' ? '#1e293b' : '#e2e8f0';
    const defStroke = document.documentElement.getAttribute('data-theme') === 'dark' ? '#334155' : '#cbd5e1';
    
    geoJsonLayer.eachLayer(function(layer) {
        let propComuna = layer.feature.properties.comuna || layer.feature.properties.COMUNA || layer.feature.properties.nombre || layer.feature.properties.id || "N/A";
        let id = String(propComuna).replace(/\D/g, ''); id = isNaN(parseInt(id,10)) ? String(propComuna) : String(parseInt(id,10)); 
        let p = mapNorm[id]||0; 
        let color = p > 0 ? getColorMapa(p, maxP) : defaultColor;
        
        layer.setStyle({
            fillColor: color,
            fillOpacity: p > 0 ? 0.85 : 0.2,
            weight: p > 0 ? 1.5 : 1,
            color: p > 0 ? '#ffffff' : defStroke
        });

        if(layer._path && p > 0) {
            layer._path.style.filter = "drop-shadow(0px 0px 4px rgba(67, 24, 255, 0.4))";
        } else if(layer._path) {
            layer._path.style.filter = "none";
        }
    });
}

function generarLeyendaCustom(canvasId, labels, datos, cols, filterType) {
    const legendContainer = document.getElementById(`legend-${canvasId}`);
    if(!legendContainer) return;
    
    let items = labels.map((l, i) => ({ label: l, val: datos[i], color: cols[i] }));
    items.sort((a,b) => b.val - a.val);
    
    let html = '';
    items.forEach(item => {
        if(item.val > 0) {
            const iconClass = getIconForLabel(item.label, filterType);
            html += `
                <div class="legend-item" onclick="triggerCrossFilter('${filterType}', '${item.label}')">
                    <div class="legend-color-box" style="background-color: ${item.color};"></div>
                    <i class="${iconClass} legend-icon" style="color: ${item.color};"></i>
                    <div class="legend-label" title="${item.label}">${item.label}</div>
                    <div class="legend-value">${item.val.toLocaleString()}</div>
                </div>
            `;
        }
    });
    legendContainer.innerHTML = html;
}

function dibujarGraficoDona(canvasId, dataObject, filterType) { 
    let labels = Object.keys(dataObject); let datos = Object.values(dataObject); let cols = labels.map((l, i) => mapeoColores[l] || coloresRespaldo[i % coloresRespaldo.length]); 
    
    if (chartInstances[canvasId]) { 
        chartInstances[canvasId].data.labels = labels; chartInstances[canvasId].data.datasets[0].data = datos; chartInstances[canvasId].data.datasets[0].backgroundColor = cols; chartInstances[canvasId].update(); 
    } else { 
        chartInstances[canvasId] = new Chart(document.getElementById(canvasId).getContext('2d'), { 
            type: 'doughnut', 
            data: { labels: labels, datasets: [{ data: datos, backgroundColor: cols, borderWidth: 0, hoverOffset: 4, cursor: 'pointer' }] }, 
            options: { 
                responsive: true, maintainAspectRatio: false, cutout: '75%', 
                plugins: { legend: { display: false } }, 
                animation: { duration: 800, easing: 'easeOutQuart' },
                onClick: (e, elements, chart) => {
                    if (elements.length > 0) {
                        const idx = elements[0].index;
                        const label = chart.data.labels[idx];
                        triggerCrossFilter(filterType, label);
                    }
                }
            } 
        }); 
    }
    generarLeyendaCustom(canvasId, labels, datos, cols, filterType);
}

function dibujarGraficoComunas(canvasId, dataObject, resetPagina = true) { 
    if (resetPagina) {
        paginaComunasActual = 0;
        dataComunasCache = dataObject;
    }

    let ag = {}; 
    for (let k in dataObject) { 
        let id = String(k||"N/A").replace(/\D/g, ''); 
        id = isNaN(parseInt(id,10)) ? String(k).trim() : String(parseInt(id,10)); 
        let l = (id==="N/A" ? "Fuera de Cali" : (!isNaN(id) ? "Comuna "+id : "Correg. "+id)); 
        ag[l] = (ag[l]||0) + dataObject[k]; 
    } 
    
    let sort = Object.entries(ag).sort((a, b) => b[1] - a[1]); 

    let totalPaginas = Math.ceil(sort.length / ITEMS_POR_PAGINA_COMUNAS);
    if (totalPaginas === 0) totalPaginas = 1;

    let inicio = paginaComunasActual * ITEMS_POR_PAGINA_COMUNAS;
    let paginados = sort.slice(inicio, inicio + ITEMS_POR_PAGINA_COMUNAS);

    let labels = paginados.map(i=>i[0]); 
    let data = paginados.map(i=>i[1]);

    document.getElementById('pag-comunas-info').innerText = `${paginaComunasActual + 1} / ${totalPaginas}`;
    
    let btnPrev = document.getElementById('btn-prev-comunas');
    let btnNext = document.getElementById('btn-next-comunas');
    
    btnPrev.disabled = paginaComunasActual === 0;
    btnNext.disabled = paginaComunasActual >= totalPaginas - 1;

    if (chartInstances[canvasId]) { 
        chartInstances[canvasId].data.labels = labels; 
        chartInstances[canvasId].data.datasets[0].data = data; 
        chartInstances[canvasId].update(); 
    } else { 
        chartInstances[canvasId] = new Chart(document.getElementById(canvasId).getContext('2d'), { 
            type: 'bar', 
            data: { labels: labels, datasets: [{ data: data, backgroundColor: '#4318ff', borderRadius: 4 }] }, 
            options: { 
                indexAxis: 'y', responsive: true, maintainAspectRatio: false, 
                plugins: { legend: { display: false } }, 
                scales: { x: { beginAtZero: true }, y: { ticks: { font: { family: 'Inter', size: 10 } } } }, 
                animation: { duration: 800, easing: 'easeOutQuart' }, 
                onClick: (e, elements, chart) => { 
                    if (elements.length > 0) { 
                        const label = chart.data.labels[elements[0].index]; 
                        const id = label.replace(/\D/g, ''); 
                        if(id) triggerCrossFilter('f-comuna', id); 
                    } 
                } 
            } 
        }); 
    }
}

window.cambiarPaginaComunas = function(direccion) {
    paginaComunasActual += direccion;
    dibujarGraficoComunas('chartComunas', dataComunasCache, false);
};

function dibujarBarraMoodle(canvasId, c) { 
    let d = [c['Tasa_Finalizacion_%']||0, c['Tasa_Abandono_%']||0, c['Tasa_Inactividad_%']||0];
    if (chartInstances[canvasId]) { chartInstances[canvasId].data.datasets[0].data=[d[0]]; chartInstances[canvasId].data.datasets[1].data=[d[1]]; chartInstances[canvasId].data.datasets[2].data=[d[2]]; chartInstances[canvasId].update(); } 
    else { chartInstances[canvasId] = new Chart(document.getElementById(canvasId).getContext('2d'), { type: 'bar', data: { labels: ['Estado %'], datasets: [ { label: 'Finalizaron', data: [d[0]], backgroundColor: '#05cd99', borderRadius: { topLeft: 6, bottomLeft: 6 } }, { label: 'Abandonaron', data: [d[1]], backgroundColor: '#ffb547' }, { label: 'Inactivos', data: [d[2]], backgroundColor: '#ee5d50', borderRadius: { topRight: 6, bottomRight: 6 } } ] }, options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', scales: { x: { stacked: true, max: 100, display: false }, y: { stacked: true, display: false } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: {size:10} } } }, animation: { duration: 800, easing: 'easeOutQuart' } } }); }
}

function dibujarRadar(pC, isG = false) { 
    const lbl = Object.keys(pC).map(q => mapeoPreguntas[q] || "Pregunta"); let d1 = Object.values(pC); let d2 = Object.keys(pC).map(q => promediosGlobalesPreguntas[q] || 0);
    if (chartInstances['chartRadar']) { chartInstances['chartRadar'].data.labels = lbl; chartInstances['chartRadar'].data.datasets[0].data = d1; chartInstances['chartRadar'].data.datasets[0].label = isG ? 'Promedio' : 'Cohorte'; if(!isG) { if(!chartInstances['chartRadar'].data.datasets[1]) chartInstances['chartRadar'].data.datasets.push({ label: 'Benchmark', backgroundColor: 'transparent', borderColor: '#64748b', borderDash: [4, 4], borderWidth: 2, pointRadius: 0 }); chartInstances['chartRadar'].data.datasets[1].data = d2; } else if (chartInstances['chartRadar'].data.datasets.length > 1) { chartInstances['chartRadar'].data.datasets.pop(); } chartInstances['chartRadar'].update(); } 
    else { let arr = [{ label: isG ? 'Promedio' : 'Cohorte', data: d1, backgroundColor: 'rgba(67, 24, 255, 0.15)', borderColor: '#4318ff', pointBackgroundColor: '#4318ff', borderWidth: 2, pointRadius: 3 }]; if (!isG) arr.push({ label: 'Benchmark', data: d2, backgroundColor: 'transparent', borderColor: '#64748b', borderDash: [4, 4], borderWidth: 2, pointRadius: 0 }); chartInstances['chartRadar'] = new Chart(document.getElementById('chartRadar').getContext('2d'), { type: 'radar', data: { labels: lbl, datasets: arr }, options: { responsive: true, maintainAspectRatio: false, scales: { r: { min: 0, max: 5, ticks: { stepSize: 1, backdropColor: 'transparent' }, pointLabels: { font: { size: 9, family: 'Inter', weight: '600' } } } }, animation: { duration: 800, easing: 'easeOutQuart' } } }); }
}

function crearTarjetaKPI(l, v, pct = null, i = "bi-bar-chart", c="primary") { let bp = pct ? `<span class="badge-kpi bg-${c} bg-opacity-10 text-${c}">${pct}</span>` : ''; return `<div class="col-6 col-md-4 col-xl"><div class="glass-card kpi-mini"><div class="kpi-mini-header"><div class="kpi-mini-icon bg-${c}-soft"><i class="bi ${i}"></i></div>${bp}</div><div class="kpi-mini-val">${v}</div><div class="kpi-mini-lbl">${l}</div></div></div>`; }
function generarBarrasCalidad(d) { let h = ''; for (let q in d) { let v = parseFloat(d[q]) || 0; let c = v >= 4.5 ? 'success' : (v >= 4.0 ? 'info' : 'danger'); h += `<div class="progress-bar-container mb-3"><div class="progress-label"><span>${q}</span><span class="fw-bold text-${c}">${v.toFixed(1)}</span></div><div class="progress-bg"><div class="progress-fill bg-${c}" style="width: ${(v/5)*100}%"></div></div></div>`; } return h; }

function agruparCursos() { const sA = document.getElementById('selector-anio'); const sB = document.getElementById('selector-curso-base'); dashboardData.cursos.forEach(c => { let m = (c.Edicion||"").match(/\b(20\d{2})\b/); if(m) añosDisponibles.add(m[1]); const b = c.Curso_Base || c.Nombre_Curso; if (!cursosPorBase[b]) cursosPorBase[b] = []; cursosPorBase[b].push(c); }); Array.from(añosDisponibles).sort().reverse().forEach(a => sA.appendChild(new Option(a, a))); Object.keys(cursosPorBase).sort().forEach(b => sB.appendChild(new Option(b, b))); }
function manejarCambioAnio() { añoActual = this.value; const b = document.getElementById('selector-curso-base').value; if (b === "ALL") actualizarPantallaGlobal(); else document.getElementById('selector-curso-base').dispatchEvent(new Event('change')); }
function manejarCambioBase() { 
    const s = this.value; const sC = document.getElementById('selector-cohorte'); const ic = document.getElementById('icon-cohorte'); const dc = document.getElementById('div-cohorte'); const lob = document.getElementById('panel-lobby-curso'); const tab = document.getElementById('contenedor-tabs'); 
    if (s === "ALL") { sC.style.display="none"; ic.style.display="none"; dc.style.display="none"; cursoActual=null; lob.style.display="none"; tab.style.display="block"; actualizarPantallaGlobal(); } 
    else { 
        let cohs = cursosPorBase[s]; if(añoActual!=="ALL") cohs = cohs.filter(c => (c.Edicion||"").includes(añoActual)); cohs = cohs.sort((a, b) => b.Edicion.localeCompare(a.Edicion)); 
        sC.innerHTML = '<option value="">⬅ Seleccione Edición</option>'; cohs.forEach(c => sC.appendChild(new Option(c.Edicion, c.Nombre_Curso))); 
        sC.style.display="block"; ic.style.display="inline"; dc.style.display="block"; sC.value=""; tab.style.display="none"; lob.style.display="block"; document.getElementById('filtros-cruzados-bar').style.display='none';
        let hL = `<div class="mb-4 text-start"><h5 class="fw-bold text-primary">${s}</h5><p class="text-muted small">Seleccione una edición</p></div><div class="row g-3">`; 
        if(cohs.length===0) hL += `<div class="col-12 text-muted py-4"><i class="bi bi-folder-x fs-2"></i> No hay cohortes este año.</div>`; 
        else cohs.forEach(c => { hL += `<div class="col-12 col-md-4 col-xl-3"><div class="glass-card text-start py-3 px-4" style="cursor:pointer;" onclick="seleccionarCohorteDesdeLobby('${c.Nombre_Curso}')"><div class="d-flex align-items-center gap-3"><i class="bi bi-mortarboard-fill fs-3 text-primary"></i><div><h6 class="fw-bold m-0">${c.Edicion}</h6><small class="text-muted">${c.Total_Inscritos} Estudiantes</small></div></div></div></div>`; }); 
        lob.innerHTML = hL + `</div>`; 
    } 
}
window.seleccionarCohorteDesdeLobby = function(n) { document.getElementById('selector-cohorte').value = n; document.getElementById('panel-lobby-curso').style.display = 'none'; document.getElementById('contenedor-tabs').style.display = 'block'; cursoActual = cursosPorBase[document.getElementById('selector-curso-base').value].find(c => c.Nombre_Curso === n); actualizarPantallaCurso(); };
function manejarCambioCohorte() { if (!this.value) { document.getElementById('panel-lobby-curso').style.display='block'; document.getElementById('contenedor-tabs').style.display='none'; return; } document.getElementById('panel-lobby-curso').style.display='none'; document.getElementById('contenedor-tabs').style.display='block'; cursoActual = cursosPorBase[document.getElementById('selector-curso-base').value].find(c => c.Nombre_Curso === this.value); actualizarPantallaCurso(); }

function actualizarPantallaGlobal(dOlap = null) { 
    if(!dOlap) cargarFiltrosOLAP();
    
    if (dOlap) {
        const dD = dOlap.Demografia; 
        const dP = dOlap.Detalle_Preguntas; 
        let kE = dD['Edad']?'Edad':'Curso de Vida'; 
        
        dibujarGraficoDona('chartSexo', dD['Sexo'], 'f-sexo'); dibujarGraficoDona('chartEdad', dD[kE], 'f-edad'); dibujarGraficoDona('chartPerfil', dD['Perfil'], 'f-perfil'); dibujarGraficoDona('chartEscolaridad', dD['Escolaridad'], 'f-escolaridad'); 
        dibujarMapaCoropletico(dD['Comuna']); dibujarGraficoComunas('chartComunas', dD['Comuna']); 
        
        toggleVisibilidad('col-sexo', dD['Sexo']); toggleVisibilidad('col-edad', dD[kE]); toggleVisibilidad('col-perfil', dD['Perfil']); toggleVisibilidad('col-escolaridad', dD['Escolaridad']); toggleVisibilidad('col-mapa', dD['Comuna']); toggleVisibilidad('col-comunas', dD['Comuna']);

        document.getElementById('titulo-radar').innerText = "Radar Filtrado vs Benchmark Global"; dibujarRadar(dP, false); document.getElementById('diagnostico-detalles').innerHTML = generarBarrasCalidad(dP);
        return;
    }

    datosFiltradosActuales=null; document.getElementById('kpi-moodle-row').classList.remove('filtro-lock'); document.getElementById('moodle-charts-wrapper').classList.remove('filtro-lock'); document.getElementById('moodle-tab').classList.remove('locked'); document.getElementById('moodle-tab').setAttribute('data-bs-toggle', 'tab'); document.getElementById('lock-icon').classList.add('d-none');
    let cF = dashboardData.cursos; if(añoActual!=="ALL") cF = cF.filter(c => (c.Edicion||"").includes(añoActual));
    const tC = cF.length; const tI = cF.reduce((s, c) => s+(c.Total_Inscritos||0), 0); let tCert = 0, tE = 0, npsP = 0, npsD = 0, chsS = 0; let dG = { 'Sexo':{}, 'Curso de Vida':{}, 'Perfil':{}, 'Escolaridad':{}, 'Comuna':{} };
    
    let cursosActivos = [];

    if (añoActual==="ALL") { 
        dG = dashboardData.demografia_global; tE = dashboardData.metadata.total_encuestas_historicas; dashboardData.cursos.forEach(c => tCert += Math.round((c.Total_Inscritos||0)*(c['Tasa_Finalizacion_%']||0)/100)); promediosGlobalesPreguntas = {}; let s={}; let cnt={}; dashboardData.cursos.forEach(c=>{if(c.Detalle_Preguntas&&c.Total_Encuestas>0){for(let k in c.Detalle_Preguntas){if(c.Detalle_Preguntas[k]>0){s[k]=(s[k]||0)+c.Detalle_Preguntas[k];cnt[k]=(cnt[k]||0)+1;}}}}); for(let k in s) promediosGlobalesPreguntas[k]=s[k]/cnt[k]; 
    } else { 
        cF.forEach(c => { tCert += Math.round((c.Total_Inscritos||0)*(c['Tasa_Finalizacion_%']||0)/100); tE+=(c.Total_Encuestas||0); chsS+=(c.Salud_Curso_CHS||0); if(c.Demografia){ for(let k in c.Demografia.Sexo) dG.Sexo[k]=(dG.Sexo[k]||0)+c.Demografia.Sexo[k]; let kE=c.Demografia.Edad?'Edad':'Curso de Vida'; for(let k in c.Demografia[kE]) dG['Curso de Vida'][k]=(dG['Curso de Vida'][k]||0)+c.Demografia[kE][k]; for(let k in c.Demografia.Perfil) dG.Perfil[k]=(dG.Perfil[k]||0)+c.Demografia.Perfil[k]; for(let k in c.Demografia.Comuna) dG.Comuna[k]=(dG.Comuna[k]||0)+c.Demografia.Comuna[k]; for(let k in c.Demografia.Escolaridad) dG.Escolaridad[k]=(dG.Escolaridad[k]||0)+c.Demografia.Escolaridad[k]; } if(c.Total_Encuestas>0){let p=Math.round((c.e_NPS+100)/2); npsP+=(p*c.Total_Encuestas)/100; npsD+=((100-p)*c.Total_Encuestas)/100;} }); promediosGlobalesPreguntas = {}; let s={}; let cnt={}; cF.forEach(c=>{if(c.Detalle_Preguntas&&c.Total_Encuestas>0){for(let k in c.Detalle_Preguntas){if(c.Detalle_Preguntas[k]>0){s[k]=(s[k]||0)+c.Detalle_Preguntas[k];cnt[k]=(cnt[k]||0)+1;}}}}); for(let k in s) promediosGlobalesPreguntas[k]=s[k]/cnt[k]; 
    }
    
    cF.forEach(c => { if(c.Es_Activo) cursosActivos.push(c); });
    
    let rowTabla = document.getElementById('row-tabla-activos');
    if (añoActual === "ALL") {
        rowTabla.style.display = 'flex';
        let tbody = document.getElementById('tbody-activos');
        let countBadge = document.getElementById('contador-activos-tabla');
        let emptyMsg = document.getElementById('mensaje-sin-activos');
        let collapseContainer = document.getElementById('collapseTablaActivos');
        
        tbody.innerHTML = '';
        countBadge.innerText = cursosActivos.length;
        
        if(cursosActivos.length === 0) {
            emptyMsg.style.display = 'block';
            collapseContainer.querySelector('.table-responsive').style.display = 'none';
        } else {
            emptyMsg.style.display = 'none';
            collapseContainer.querySelector('.table-responsive').style.display = 'block';
            cursosActivos.sort((a,b) => b.Total_Inscritos - a.Total_Inscritos).forEach(ca => {
                let rowBg = document.documentElement.getAttribute('data-theme') === 'dark' ? 'rgba(255,255,255,0.02)' : '#ffffff';
                let textColor = document.documentElement.getAttribute('data-theme') === 'dark' ? '#f8fafc' : '#1e293b';
                
                let tr = document.createElement('tr');
                tr.style.backgroundColor = rowBg;
                tr.style.color = textColor;
                tr.style.borderBottom = '1px solid var(--border-color)';
                
                let ap = Math.round((ca.Total_Inscritos || 0) * (ca['Tasa_Finalizacion_%'] || 0) / 100);
                let chsColor = ca.Salud_Curso_CHS >= 80 ? 'success' : (ca.Salud_Curso_CHS >= 60 ? 'warning' : 'danger');
                
                tr.innerHTML = `
                    <td class="px-4 py-3 fw-semibold text-truncate" style="max-width: 250px;" title="${ca.Curso_Base}">${ca.Curso_Base}</td>
                    <td class="px-4 py-3 text-muted small">${ca.Edicion}</td>
                    <td class="px-4 py-3 text-center fw-bold font-monospace">${(ca.Total_Inscritos || 0).toLocaleString()}</td>
                    <td class="px-4 py-3 text-center"><span class="badge bg-success bg-opacity-10 text-success rounded-pill border border-success border-opacity-25 px-2">${ap.toLocaleString()}</span></td>
                    <td class="px-4 py-3 text-center"><span class="fw-bold text-${chsColor}">${ca.Salud_Curso_CHS}</span></td>
                `;
                tbody.appendChild(tr);
            });
        }
    } else {
        rowTabla.style.display = 'none';
    }

    let labelActivos = añoActual === "ALL" ? ((dashboardData.metadata.cursos_activos !== undefined ? dashboardData.metadata.cursos_activos : cursosActivos.length) + " Activos") : null;
    document.getElementById('kpi-global-row').innerHTML = `${crearTarjetaKPI("Auditados", tC, labelActivos, "bi-journal-bookmark", "primary")} ${crearTarjetaKPI("Matrículas", tI.toLocaleString(), null, "bi-people", "info")} ${crearTarjetaKPI("Aprobados", tCert.toLocaleString(), tI?Math.round((tCert/tI)*100)+"%":"0%", "bi-check-circle", "success")} ${crearTarjetaKPI("Encuestas", tE.toLocaleString(), null, "bi-ui-radios", "warning")} ${crearTarjetaKPI("CHS", añoActual==="ALL"?dashboardData.kpis_globales.chs_promedio_secretaria:(tC?(chsS/tC).toFixed(1):0), null, "bi-heart-pulse", "danger")} ${crearTarjetaKPI("e-NPS", añoActual==="ALL"?dashboardData.kpis_globales.nps_global:(tE?Math.round(((npsP-npsD)/tE)*100):0), null, "bi-emoji-smile", "primary")}`; 
    
    dibujarGraficoDona('chartSexo', dG['Sexo'], 'f-sexo'); dibujarGraficoDona('chartEdad', dG['Curso de Vida'], 'f-edad'); dibujarGraficoDona('chartPerfil', dG['Perfil'], 'f-perfil'); dibujarGraficoDona('chartEscolaridad', dG['Escolaridad'], 'f-escolaridad'); 
    dibujarMapaCoropletico(dG['Comuna']); dibujarGraficoComunas('chartComunas', dG['Comuna']); 
    
    toggleVisibilidad('col-sexo', dG['Sexo']); toggleVisibilidad('col-edad', dG['Curso de Vida']); toggleVisibilidad('col-perfil', dG['Perfil']); toggleVisibilidad('col-escolaridad', dG['Escolaridad']); toggleVisibilidad('col-mapa', dG['Comuna']); toggleVisibilidad('col-comunas', dG['Comuna']);
    
    let tF=0, tA=0, tIn=0;
    let mD = 0; 
    cF.forEach(c => { 
        let i = c.Total_Inscritos||0; 
        tF+=(c['Tasa_Finalizacion_%']/100)*i; 
        tA+=(c['Tasa_Abandono_%']/100)*i; 
        tIn+=(c['Tasa_Inactividad_%']/100)*i; 
        if (c.Tiempo_Maximo_Dias && c.Tiempo_Maximo_Dias > mD) { 
            mD = c.Tiempo_Maximo_Dias; 
        } 
    }); 
    let pF=tI?Math.round((tF/tI)*100):0; let pA=tI?Math.round((tA/tI)*100):0; let pI=tI?Math.round((tIn/tI)*100):0; 
    document.getElementById('kpi-moodle-row').innerHTML = `${crearTarjetaKPI("Finalización", pF+"%", null, "bi-trophy", "success")} ${crearTarjetaKPI("Abandono", pA+"%", null, "bi-exclamation-triangle", "warning")} ${crearTarjetaKPI("Inactividad", pI+"%", null, "bi-door-closed", "danger")}`; 
    
    let formatGlobal = mD > 1000 ? (mD/1000).toFixed(1) + 'K' : Math.round(mD).toLocaleString();
    document.getElementById('tiempo-consumo-dias').innerText = formatGlobal; 
    document.getElementById('tiempo-consumo-lbl').innerText = "Días Acumulados de Formación";

    dibujarBarraMoodle('chartMoodleBar', { 'Tasa_Finalizacion_%': pF, 'Tasa_Abandono_%': pA, 'Tasa_Inactividad_%': pI }); 
    document.getElementById('titulo-radar').innerText = añoActual==="ALL"?"Perfil Institucional Consolidado":`Perfil Consolidado (${añoActual})`; dibujarRadar(promediosGlobalesPreguntas, true); document.getElementById('diagnostico-detalles').innerHTML = generarBarrasCalidad(promediosGlobalesPreguntas);
}

function actualizarPantallaCurso(dOlap = null) { 
    if(!dOlap) cargarFiltrosOLAP();
    const dD = dOlap?dOlap.Demografia:cursoActual.Demografia; const dP = dOlap?dOlap.Detalle_Preguntas:cursoActual.Detalle_Preguntas; const tE = dOlap?dOlap.Total_Encuestas:cursoActual.Total_Encuestas; const dN = dOlap?dOlap.e_NPS:cursoActual.e_NPS; const bI = cursoActual.Total_Inscritos; const tF = cursoActual['Tasa_Finalizacion_%'];
    document.getElementById('kpi-global-row').innerHTML = `${crearTarjetaKPI("Matrículas", bI.toLocaleString(), null, "bi-people", "info")} ${crearTarjetaKPI("Aprobados", Math.round((bI*tF)/100).toLocaleString(), tF+"%", "bi-check-circle", "success")} ${crearTarjetaKPI(dOlap?"Encuestas (Filtro)":"Encuestas", tE.toLocaleString(), null, "bi-ui-radios", dOlap?"primary":"warning")} ${crearTarjetaKPI("CHS", cursoActual.Salud_Curso_CHS, null, "bi-heart-pulse", "danger")} ${crearTarjetaKPI("e-NPS", dN, null, "bi-emoji-smile", "primary")}`; 
    let kE = dD['Edad']?'Edad':'Curso de Vida'; 
    
    dibujarGraficoDona('chartSexo', dD['Sexo'], 'f-sexo'); dibujarGraficoDona('chartEdad', dD[kE], 'f-edad'); dibujarGraficoDona('chartPerfil', dD['Perfil'], 'f-perfil'); dibujarGraficoDona('chartEscolaridad', dD['Escolaridad'], 'f-escolaridad'); 
    dibujarMapaCoropletico(dD['Comuna']); dibujarGraficoComunas('chartComunas', dD['Comuna']); 
    
    toggleVisibilidad('col-sexo', dD['Sexo']); toggleVisibilidad('col-edad', dD[kE]); toggleVisibilidad('col-perfil', dD['Perfil']); toggleVisibilidad('col-escolaridad', dD['Escolaridad']); toggleVisibilidad('col-mapa', dD['Comuna']); toggleVisibilidad('col-comunas', dD['Comuna']);

    if(!dOlap) { 
        document.getElementById('kpi-moodle-row').innerHTML = `${crearTarjetaKPI("Finalización", tF+"%", null, "bi-trophy", "success")} ${crearTarjetaKPI("Abandono", cursoActual['Tasa_Abandono_%']+"%", null, "bi-exclamation-triangle", "warning")} ${crearTarjetaKPI("Inactividad", cursoActual['Tasa_Inactividad_%']+"%", null, "bi-door-closed", "danger")}`; 
        
        document.getElementById('tiempo-consumo-dias').innerText = formatoDiasHoras(cursoActual['Tiempo_Maximo_Dias']); 
        document.getElementById('tiempo-consumo-lbl').innerText = "Tiempo Máximo de Finalización";

        dibujarBarraMoodle('chartMoodleBar', cursoActual); 
    }
    document.getElementById('titulo-radar').innerText = dOlap?"Radar Filtrado vs Benchmark":"Radar vs Benchmark Global"; dibujarRadar(dP, false); document.getElementById('diagnostico-detalles').innerHTML = generarBarrasCalidad(dP);
}

function obtenerModa(objetoData) {
    if(!objetoData || Object.keys(objetoData).length === 0) return "N/A";
    let maxVal = -1; let moda = "N/A";
    for (let key in objetoData) { if (objetoData[key] > maxVal && key !== "N/A") { maxVal = objetoData[key]; moda = key; } }
    return moda;
}

window.poblarSelectoresComparador = function() {
    if (!dashboardData || !dashboardData.cursos) return;
    
    let opcionesHTML = '<option value="">+ Seleccionar Curso</option>';
    
    let cursosSeguros = [...dashboardData.cursos].sort((a,b) => {
        let nameA = a.Nombre_Curso || "";
        let nameB = b.Nombre_Curso || "";
        return nameA.localeCompare(nameB);
    });

    cursosSeguros.forEach(c => {
        let nBase = c.Curso_Base || c.Nombre_Curso || "Curso";
        let nEd = c.Edicion || "Sin Fecha";
        opcionesHTML += `<option value="${c.Nombre_Curso}">${nBase} - ${nEd}</option>`;
    });

    for(let i=1; i<=4; i++) {
        let sel = document.getElementById(`select-comp-${i}`);
        if(sel) sel.innerHTML = opcionesHTML;
    }
};

window.actualizarComparador = function(slotIndex, courseName) {
    const contentDiv = document.getElementById(`comp-content-${slotIndex}`);
    const emptyDiv = document.getElementById(`comp-empty-${slotIndex}`);
    
    if(!courseName) { contentDiv.classList.add('d-none'); emptyDiv.classList.remove('d-none'); return; }
    
    const curso = dashboardData.cursos.find(c => c.Nombre_Curso === courseName);
    if(!curso) return;

    contentDiv.classList.remove('d-none'); emptyDiv.classList.add('d-none');
    
    let fuga = (curso['Tasa_Abandono_%'] || 0) + (curso['Tasa_Inactividad_%'] || 0);
    document.getElementById(`comp-fin-${slotIndex}`).innerText = (curso['Tasa_Finalizacion_%']||0) + "%";
    document.getElementById(`comp-fug-${slotIndex}`).innerText = fuga.toFixed(1) + "%";
    
    let inscritos = curso.Total_Inscritos || 0;
    let encuestas = curso.Total_Encuestas || 0;
    let silencio = inscritos > 0 ? ((inscritos - encuestas) / inscritos) * 100 : 0;
    document.getElementById(`comp-mat-${slotIndex}`).innerText = inscritos.toLocaleString();
    document.getElementById(`comp-sil-${slotIndex}`).innerHTML = `<span class="${silencio > 50 ? 'text-danger' : 'text-success'}">${silencio.toFixed(1)}%</span>`;

    let chs = curso.Salud_Curso_CHS || 0;
    let chsColor = chs >= 80 ? 'text-success' : (chs >= 60 ? 'text-warning' : 'text-danger');
    document.getElementById(`comp-chs-${slotIndex}`).innerHTML = `<span class="${chsColor}">${chs}</span> / 100`;

    let qObjCumplido = curso.Detalle_Preguntas ? (curso.Detalle_Preguntas["¿Se cumplió el objetivo de la capacitación?"] || 0) : 0;
    let qObjConocer = curso.Detalle_Preguntas ? (curso.Detalle_Preguntas["¿Se dio a conocer el objetivo de la capacitación?"] || 0) : 0;
    
    let contenedorExp = document.getElementById(`comp-exp-container-${slotIndex}`);
    if (qObjCumplido > 0 && qObjConocer > 0) {
        let brecha = qObjCumplido - qObjConocer;
        let brechaFormat = parseFloat(brecha.toFixed(1)); 
        
        if(brechaFormat > 0) {
            contenedorExp.innerHTML = `<span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25" title="La calidad percibida superó lo que se prometió al inicio del curso."><i class="bi bi-arrow-up-right-circle-fill"></i> Superó Promesa (+${brechaFormat})</span>`;
        } else if (brechaFormat < 0) {
            contenedorExp.innerHTML = `<span class="badge bg-danger bg-opacity-10 text-danger border border-danger border-opacity-25" title="El curso prometió más de lo que realmente entregó."><i class="bi bi-arrow-down-right-circle-fill"></i> Decepcionó (${brechaFormat})</span>`;
        } else {
            contenedorExp.innerHTML = `<span class="badge bg-info bg-opacity-10 text-info border border-info border-opacity-25" title="El curso entregó exactamente lo que prometió, ni más ni menos."><i class="bi bi-check-circle-fill"></i> Cumplió Exacto (0.0)</span>`;
        }
    } else {
        contenedorExp.innerHTML = `<span class="badge bg-secondary bg-opacity-10 text-secondary border border-secondary border-opacity-25">Sin Datos</span>`;
    }

    document.getElementById(`comp-time-${slotIndex}`).innerText = formatoDiasHoras(curso.Tiempo_Maximo_Dias || curso.Tiempo_Promedio_Dias);
    
    const setBarraCalidad = (idBase, val1, val2 = null) => {
        let v = parseFloat(val1) || 0;
        if(val2 !== null) { 
            let v2 = parseFloat(val2) || 0;
            v = (v + v2) / 2;
        }
        let p = (v / 5) * 100;
        let colorClase = v >= 4.5 ? 'bg-success' : (v >= 4.0 ? 'bg-warning' : 'bg-danger');
        
        document.getElementById(`${idBase}-val-${slotIndex}`).innerText = v.toFixed(1);
        let barra = document.getElementById(`${idBase}-bar-${slotIndex}`);
        barra.style.width = `${p}%`;
        barra.className = `progress-bar ${colorClase}`;
    };

    let qUx = curso.Detalle_Preguntas ? curso.Detalle_Preguntas["¿Cómo califica las condiciones del espacio físico o medio virtual en el que se desarrolló la capacitación?"] : 0;
    let qMat = curso.Detalle_Preguntas ? curso.Detalle_Preguntas["¿El material utilizado permitió el entendimiento del tema?"] : 0;
    let qInq = curso.Detalle_Preguntas ? curso.Detalle_Preguntas["¿Durante la capacitación se dio espacio para la solución de inquietudes?"] : 0;
    let qMet = curso.Detalle_Preguntas ? curso.Detalle_Preguntas["¿La metodología utilizada por el facilitador permitió el entendimiento de los contenidos?"] : 0;
    let qPrac = curso.Detalle_Preguntas ? curso.Detalle_Preguntas["¿Los conocimientos recibidos durante la capacitación le permitirán llevarlos a la práctica en su vida cotidiana?"] : 0;
    let qNov = curso.Detalle_Preguntas ? curso.Detalle_Preguntas["¿La capacitación aportó nuevos conceptos y/o técnicas que antes no conocía?"] : 0;

    setBarraCalidad('comp-ux', qUx, qMat);
    setBarraCalidad('comp-met', qMet);
    setBarraCalidad('comp-prac', qPrac, qNov);
    
    let modaProf = curso.Demografia ? obtenerModa(curso.Demografia.Perfil) : "N/A";
    document.getElementById(`comp-prof-${slotIndex}`).innerText = modaProf;
    document.getElementById(`comp-prof-${slotIndex}`).title = modaProf;
    
    let kE = (curso.Demografia && curso.Demografia.Edad) ? 'Edad' : 'Curso de Vida';
    document.getElementById(`comp-edad-${slotIndex}`).innerText = curso.Demografia ? obtenerModa(curso.Demografia[kE]) : "N/A";
    
    let modaCom = curso.Demografia ? obtenerModa(curso.Demografia.Comuna) : "N/A";
    if(modaCom !== "N/A" && !isNaN(modaCom)) modaCom = "Comuna " + modaCom;
    document.getElementById(`comp-com-${slotIndex}`).innerText = modaCom;
};

// ==========================================
// FUNCIÓN NUEVA: Reemplaza el <script> en HTML
// ==========================================
function generarColumnasComparador() {
    let htmlColumnas = '';
    for(let i=1; i<=4; i++) {
        htmlColumnas += `
        <div class="col-10 col-md-6 col-xl-3">
            <div class="glass-card p-0 overflow-hidden d-flex flex-column h-100" style="border-radius: 16px;">
                <div class="p-3 bg-primary bg-opacity-10 border-bottom border-primary border-opacity-25">
                    <select id="select-comp-${i}" class="form-select-custom w-100 fw-bold text-primary select-comparador" onchange="actualizarComparador(${i}, this.value)">
                        <option value="">+ Seleccionar Curso</option>
                    </select>
                </div>
                <div id="comp-content-${i}" class="p-3 d-none flex-grow-1">
                    
                    <div class="d-flex justify-content-between align-items-center mb-3 pb-3 border-bottom border-danger border-opacity-10">
                        <div class="text-center w-50 border-end border-danger border-opacity-10">
                            <div class="text-muted" style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase;">Éxito Operativo</div>
                            <div class="fw-bold text-success" style="font-size: 1.5rem; line-height: 1;" id="comp-fin-${i}">-</div>
                        </div>
                        <div class="text-center w-50">
                            <div class="text-danger" style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase;"><i class="bi bi-exclamation-triangle-fill"></i> Fuga Crítica</div>
                            <div class="fw-bold text-danger" style="font-size: 1.5rem; line-height: 1;" id="comp-fug-${i}">-</div>
                        </div>
                    </div>

                    <div class="comp-metric-row"><span class="comp-label">Matrículas Iniciales</span> <span class="comp-val font-monospace" id="comp-mat-${i}">-</span></div>
                    <div class="comp-metric-row"><span class="comp-label">Tasa de Silencio</span> <span class="comp-val fw-bold" id="comp-sil-${i}" title="Porcentaje de matriculados que no llenaron la encuesta">-</span></div>
                    <div class="comp-metric-row"><span class="comp-label">Score de Salud (CHS)</span> <span class="comp-val fw-bold" id="comp-chs-${i}">-</span></div>
                    
                    <div class="comp-metric-row border-0 pb-0"><span class="comp-label" title="Diferencia entre si se dio a conocer el objetivo y si realmente se cumplió.">Expectativa vs Realidad <i class="bi bi-info-circle text-muted" style="font-size:0.7rem;"></i></span></div>
                    <div class="mb-3 text-end" id="comp-exp-container-${i}">-</div>

                    <h6 class="fw-bold text-muted mb-2 mt-4" style="font-size:0.8rem;"><i class="bi bi-search text-warning"></i> Análisis de Causas de Fuga</h6>
                    
                    <div class="comp-metric-row border-0 pb-0"><span class="comp-label" style="font-size: 0.75rem;">Tiempo Máximo de Retención</span></div>
                    <div class="mb-2 text-end fw-bold text-primary" style="font-size: 0.85rem;" id="comp-time-${i}">-</div>

                    <div class="comp-metric-row flex-column align-items-stretch gap-1 mb-2"><div class="d-flex justify-content-between"><span class="comp-label" style="font-size: 0.75rem;">Fricción de Plataforma (UX)</span> <span class="fw-bold text-main" style="font-size: 0.75rem;" id="comp-ux-val-${i}">-</span></div><div class="progress" style="height: 6px; background: rgba(0,0,0,0.05);"><div class="progress-bar" id="comp-ux-bar-${i}" style="width: 0%;"></div></div></div>
                    
                    <div class="comp-metric-row flex-column align-items-stretch gap-1 mb-2"><div class="d-flex justify-content-between"><span class="comp-label" style="font-size: 0.75rem;">Claridad Metodológica</span> <span class="fw-bold text-main" style="font-size: 0.75rem;" id="comp-met-val-${i}">-</span></div><div class="progress" style="height: 6px; background: rgba(0,0,0,0.05);"><div class="progress-bar" id="comp-met-bar-${i}" style="width: 0%;"></div></div></div>
                    
                    <div class="comp-metric-row flex-column align-items-stretch gap-1"><div class="d-flex justify-content-between"><span class="comp-label" style="font-size: 0.75rem;">Aplicabilidad al Cargo</span> <span class="fw-bold text-main" style="font-size: 0.75rem;" id="comp-prac-val-${i}">-</span></div><div class="progress" style="height: 6px; background: rgba(0,0,0,0.05);"><div class="progress-bar" id="comp-prac-bar-${i}" style="width: 0%;"></div></div></div>
                    
                    <h6 class="fw-bold text-muted mb-2 mt-4" style="font-size:0.8rem;"><i class="bi bi-people-fill text-info"></i> Audiencia Predominante</h6>
                    <div class="comp-metric-row"><span class="comp-label">Profesión</span> <span class="comp-val text-truncate" style="max-width: 120px;" id="comp-prof-${i}" title="-">-</span></div>
                    <div class="comp-metric-row"><span class="comp-label">Rango Edad</span> <span class="comp-val" id="comp-edad-${i}">-</span></div>
                    <div class="comp-metric-row"><span class="comp-label">Territorio</span> <span class="comp-val" id="comp-com-${i}">-</span></div>
                </div>
                <div id="comp-empty-${i}" class="p-4 text-center text-muted d-flex flex-column justify-content-center align-items-center h-100">
                    <i class="bi bi-funnel-fill fs-1 mb-2 opacity-25 text-danger"></i>
                    <p class="small">Elige una edición para evaluar su nivel de deserción.</p>
                </div>
            </div>
        </div>`;
    }
    const contenedor = document.getElementById('comparador-row');
    if (contenedor) contenedor.innerHTML = htmlColumnas;
}

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Ejecutar la función que inyecta el HTML del comparador
    generarColumnasComparador();
    
    cambiarTema(localStorage.getItem('temaDashboard') || 'light');
    
    const triggerTabList = document.querySelectorAll('button[data-bs-toggle="tab"]');
    triggerTabList.forEach(triggerEl => {
      triggerEl.addEventListener('shown.bs.tab', event => {
        for (let id in chartInstances) { if (chartInstances[id]) chartInstances[id].resize(); }
        if (event.target.getAttribute('data-bs-target') === '#panel-global' && mapInstance) { 
            setTimeout(() => {
                mapInstance.invalidateSize();
                if(geoJsonLayer) mapInstance.fitBounds(geoJsonLayer.getBounds(), {padding: [10, 10]});
            }, 50); 
        }
      });
    });

    const collapseElementList = document.querySelectorAll('.collapse');
    collapseElementList.forEach(collapseEl => {
        collapseEl.addEventListener('show.bs.collapse', e => {
            if (e.target.previousElementSibling) e.target.previousElementSibling.classList.remove('collapsed');
        });
        collapseEl.addEventListener('hide.bs.collapse', e => {
            if (e.target.previousElementSibling) e.target.previousElementSibling.classList.add('collapsed');
        });
    });

    try { 
        const res = await fetch('dashboard_data.json?v=' + new Date().getTime()); 
        dashboardData = await res.json(); 
    } catch (e) { 
        console.warn("Entorno local detectado. Cargando datos de respaldo temporal (Fallback) para la vista previa.");
        dashboardData = {
            "metadata": { "total_cursos_analizados": 5, "total_encuestas_historicas": 1250, "total_estudiantes_unicos": 3800, "cursos_activos": 2 },
            "kpis_globales": { "chs_promedio_secretaria": 85.4, "nps_global": 72 },
            "demografia_global": {
                "Sexo": {"Femenino": 2500, "Masculino": 1300},
                "Curso de Vida": {"Juventud": 1000, "Adultez": 2500, "Vejez": 300},
                "Perfil": {"Médico": 800, "Enfermera": 1200, "Auxiliar": 1800},
                "Escolaridad": {"Profesional": 1500, "Técnico": 2000, "Bachiller": 300},
                "Comuna": {"2": 500, "17": 800, "19": 600, "22": 400}
            },
            "cursos": [
                {
                    "Nombre_Curso": "Bioseguridad_2023", "Curso_Base": "Bioseguridad", "Edicion": "2023-01",
                    "Total_Inscritos": 500, "Total_Encuestas": 300, "Salud_Curso_CHS": 88, "e_NPS": 75,
                    "Tasa_Finalizacion_%": 80, "Tasa_Abandono_%": 15, "Tasa_Inactividad_%": 5, "Tiempo_Maximo_Dias": 12, "Es_Activo": true,
                    "Detalle_Preguntas": { "¿Se dio a conocer el objetivo de la capacitación?": 4.8, "¿La metodología utilizada por el facilitador permitió el entendimiento de los contenidos?": 4.5, "¿Cómo califica las condiciones del espacio físico o medio virtual en el que se desarrolló la capacitación?": 4.2 },
                    "Demografia": { "Sexo": {"Femenino": 350, "Masculino": 150}, "Edad": {"Juventud": 200, "Adultez": 300}, "Perfil": {"Enfermera": 250, "Auxiliar": 250}, "Escolaridad": {"Técnico": 300, "Profesional": 200}, "Comuna": {"17": 150, "19": 100} },
                    "Registros_Crudos": []
                }
            ]
        };
    }
    window.poblarSelectoresComparador();

    try {
        let resArchivo = null;
        try { resArchivo = await fetch('mc_comunas.json'); } catch(e) {}
        if (!resArchivo || !resArchivo.ok) { resArchivo = await fetch('mc_comunas (1)_2.geojson'); }
        
        let gd = await resArchivo.json(); 
        if(gd && gd.features) { 
            geoJsonDataRaw = gd; 
        }
    } catch (e) { 
        console.warn("No se pudo cargar el mapa geoJSON local. Verifica que el archivo exista en la carpeta.", e); 
        geoJsonDataRaw = { "type": "FeatureCollection", "features": [] }; 
    }
    
    Chart.defaults.font.family = 'Inter'; 
    inicializarMapa(); agruparCursos(); 
    
    document.getElementById('selector-anio').addEventListener('change', manejarCambioAnio); 
    document.getElementById('selector-curso-base').addEventListener('change', manejarCambioBase); 
    document.getElementById('selector-cohorte').addEventListener('change', manejarCambioCohorte);
    
    const tI = dashboardData.cursos.reduce((s, c) => s+(c.Total_Inscritos||0), 0); 
    let tC = 0; dashboardData.cursos.forEach(c => { tC += Math.round((c.Total_Inscritos||0)*(c['Tasa_Finalizacion_%']||0)/100); });
    const unicos = dashboardData.metadata.total_estudiantes_unicos || tI;
    
    let totalCursosActivos = 0;
    if (dashboardData.metadata && dashboardData.metadata.cursos_activos !== undefined) {
        totalCursosActivos = dashboardData.metadata.cursos_activos;
    } else if (dashboardData.cursos) {
        totalCursosActivos = dashboardData.cursos.filter(c => c.Es_Activo === true).length;
    }

    document.getElementById('bento-cursos').innerText = dashboardData.metadata.total_cursos_analizados||0; 
    document.getElementById('bento-activos').innerText = totalCursosActivos;
    document.getElementById('bento-matriculas').innerText = tI.toLocaleString(); 
    document.getElementById('bento-unicos').innerText = unicos.toLocaleString() + " Únicos";
    document.getElementById('bento-certificados').innerText = tC.toLocaleString();
    document.getElementById('bento-encuestas').innerText = dashboardData.metadata.total_encuestas_historicas.toLocaleString() + " Encuestas";
    document.getElementById('bento-chs').innerText = dashboardData.kpis_globales.chs_promedio_secretaria;

    actualizarPantallaGlobal();
});