// Built-in playable historical demo scenarios so users can experience Waymark Wargaming in one click.
// No DOM here so it can be validated in Node unit tests.

export function battleOfTheBulgeDemo() {
  const sides = [
    { id: 'allies', name: 'Allies (US)', color: '#2563eb', affiliation: 'F' },
    { id: 'axis', name: 'Axis (Panzer)', color: '#dc2626', affiliation: 'H' },
  ];

  // Setup (Dec 16, 1944 05:30 — Eve of Unternehmen Wacht am Rhein)
  const unitsT0 = [
    // Allies
    { id: 'u_viii_hq', name: 'VIII Corps HQ', side: 'allies', kind: 'hq', echelon: 'I', strength: 100, status: 'ready', rangeKm: 0, speedKmh: 20, spotted: true, supply: 100, lngLat: [5.716, 50.001], notes: 'Gen. Middleton — holding the 85-mile Ardennes Ghost Front.' },
    { id: 'u_101', name: '101st Airborne Div', side: 'allies', kind: 'infantry', echelon: 'I', strength: 95, status: 'ready', rangeKm: 4, speedKmh: 18, spotted: true, supply: 90, parent: 'u_viii_hq', lngLat: [5.520, 49.940], notes: 'Rushing northeast by truck from Mourmelon to secure Bastogne.' },
    { id: 'u_10arm', name: '10th Armored (CCB)', side: 'allies', kind: 'armor', echelon: 'H', strength: 90, status: 'ready', rangeKm: 5, speedKmh: 30, spotted: true, supply: 95, parent: 'u_viii_hq', lngLat: [5.775, 50.048], notes: 'Blocking force forward of Bastogne near Noville.' },
    { id: 'u_7arm', name: '7th Armored Div', side: 'allies', kind: 'armor', echelon: 'I', strength: 90, status: 'ready', rangeKm: 5, speedKmh: 30, spotted: true, supply: 95, parent: 'u_viii_hq', lngLat: [6.040, 50.295], notes: 'Moving to reinforce the vital St. Vith road junction.' },
    { id: 'u_106', name: '106th Infantry Div', side: 'allies', kind: 'infantry', echelon: 'I', strength: 85, status: 'ready', rangeKm: 3, speedKmh: 10, spotted: true, supply: 80, parent: 'u_viii_hq', lngLat: [6.290, 50.245], notes: 'Green division stretched thin across the Schnee Eifel ridge.' },
    { id: 'u_99', name: '99th Infantry Div', side: 'allies', kind: 'infantry', echelon: 'I', strength: 95, status: 'ready', rangeKm: 4, speedKmh: 10, spotted: true, supply: 100, parent: 'u_viii_hq', lngLat: [6.235, 50.455], notes: 'Anchoring the northern shoulder along Elsenborn Ridge.' },
    { id: 'u_2inf', name: '2nd Infantry Div', side: 'allies', kind: 'infantry', echelon: 'I', strength: 95, status: 'ready', rangeKm: 4, speedKmh: 12, spotted: true, supply: 100, parent: 'u_viii_hq', lngLat: [6.140, 50.480], notes: 'Veteran division reinforcing Krinkelt-Rocherath & Elsenborn.' },
    { id: 'u_28', name: '28th Infantry Div', side: 'allies', kind: 'infantry', echelon: 'I', strength: 85, status: 'ready', rangeKm: 3, speedKmh: 10, spotted: true, supply: 85, parent: 'u_viii_hq', lngLat: [6.030, 50.055], notes: '"Bloody Bucket" holding Skyline Drive and Clervaux.' },

    // Axis
    { id: 'u_5pz_hq', name: '5th Panzer Army HQ', side: 'axis', kind: 'hq', echelon: 'I', strength: 100, status: 'ready', rangeKm: 0, speedKmh: 20, spotted: false, supply: 90, lngLat: [6.525, 49.975], notes: 'Gen. von Manteuffel — directing the central Ardennes breakthrough.' },
    { id: 'u_peiper', name: 'KG Peiper (1st SS)', side: 'axis', kind: 'armor', echelon: 'H', strength: 100, status: 'ready', rangeKm: 6, speedKmh: 34, spotted: false, supply: 80, parent: 'u_5pz_hq', lngLat: [6.365, 50.355], notes: 'Spearhead of 6th Panzer Army racing for the Meuse bridges. Fuel critical.' },
    { id: 'u_12ss', name: '12th SS Panzer Div', side: 'axis', kind: 'armor', echelon: 'I', strength: 95, status: 'ready', rangeKm: 5, speedKmh: 28, spotted: false, supply: 85, parent: 'u_5pz_hq', lngLat: [6.390, 50.435], notes: 'Assaulting the Losheim Gap toward Elsenborn Ridge.' },
    { id: 'u_2pz', name: '2nd Panzer Div', side: 'axis', kind: 'armor', echelon: 'I', strength: 100, status: 'ready', rangeKm: 6, speedKmh: 32, spotted: false, supply: 85, parent: 'u_5pz_hq', lngLat: [6.220, 50.070], notes: 'Main armor thrust through Clervaux toward Houffalize & Dinant.' },
    { id: 'u_lehr', name: 'Panzer Lehr Div', side: 'axis', kind: 'armor', echelon: 'I', strength: 95, status: 'ready', rangeKm: 6, speedKmh: 30, spotted: false, supply: 85, parent: 'u_5pz_hq', lngLat: [6.210, 49.975], notes: 'Elite armored division driving on Bastogne from the east.' },
    { id: 'u_26vg', name: '26th Volksgrenadier', side: 'axis', kind: 'infantry', echelon: 'I', strength: 90, status: 'ready', rangeKm: 3, speedKmh: 12, spotted: false, supply: 85, parent: 'u_5pz_hq', lngLat: [6.185, 50.015], notes: 'Infantry force tasked with investing Bastogne.' },
    { id: 'u_116pz', name: '116th Panzer Div', side: 'axis', kind: 'armor', echelon: 'I', strength: 95, status: 'ready', rangeKm: 5, speedKmh: 30, spotted: false, supply: 85, parent: 'u_5pz_hq', lngLat: [6.260, 50.140], notes: '"Greyhound" division pushing toward Houffalize & La Roche.' },
    { id: 'u_arty', name: '6th Panzer Artillery', side: 'axis', kind: 'artillery', echelon: 'H', strength: 100, status: 'ready', rangeKm: 18, speedKmh: 16, spotted: false, supply: 90, parent: 'u_5pz_hq', lngLat: [6.380, 50.285], notes: 'Heavy barrage supporting the opening Ardennes breakthrough.' },
  ];

  // Helper to clone & patch units for subsequent historical turns
  const stepUnits = (prev, patches) => prev.map((u) => {
    const p = patches[u.id];
    if (!p) return { ...u, from: [...u.lngLat] };
    return { ...u, ...p, from: [...u.lngLat], lngLat: p.lngLat || u.lngLat };
  });

  // Turn 1: Dec 17 — German Breakthrough, Peiper reaches Stavelot, 101st rushes into Bastogne
  const unitsT1 = stepUnits(unitsT0, {
    u_101: { lngLat: [5.718, 50.004], status: 'ready', supply: 85 },
    u_10arm: { lngLat: [5.762, 50.055], status: 'engaged', strength: 80, supply: 80 },
    u_7arm: { lngLat: [6.125, 50.281], status: 'engaged', strength: 85, supply: 85 },
    u_106: { lngLat: [6.225, 50.255], status: 'degraded', strength: 55, supply: 45 },
    u_99: { lngLat: [6.195, 50.462], status: 'engaged', strength: 85, supply: 90 },
    u_peiper: { lngLat: [5.955, 50.392], status: 'engaged', strength: 92, supply: 62, spotted: true },
    u_12ss: { lngLat: [6.250, 50.440], status: 'engaged', strength: 88, supply: 78, spotted: true },
    u_2pz: { lngLat: [5.945, 50.085], status: 'engaged', strength: 92, supply: 75, spotted: true },
    u_lehr: { lngLat: [5.910, 49.975], status: 'ready', strength: 90, supply: 76, spotted: true },
    u_26vg: { lngLat: [5.860, 50.015], status: 'engaged', strength: 85, supply: 78, spotted: true },
    u_116pz: { lngLat: [5.995, 50.155], status: 'ready', strength: 90, supply: 78, spotted: true },
    u_28: { lngLat: [5.890, 49.960], status: 'degraded', strength: 62, supply: 60 },
  });

  // Turn 2: Dec 19 — Bastogne Encircled, St. Vith under heavy pressure, 2nd Panzer races west
  const unitsT2 = stepUnits(unitsT1, {
    u_101: { lngLat: [5.718, 50.002], status: 'engaged', strength: 88, supply: 58 },
    u_10arm: { lngLat: [5.745, 50.025], status: 'engaged', strength: 72, supply: 55 },
    u_7arm: { lngLat: [6.095, 50.280], status: 'engaged', strength: 74, supply: 65 },
    u_106: { lngLat: [6.175, 50.268], status: 'degraded', strength: 35, supply: 25 },
    u_99: { lngLat: [6.165, 50.468], status: 'engaged', strength: 80, supply: 85 },
    u_2inf: { lngLat: [6.125, 50.478], status: 'engaged', strength: 88, supply: 90 },
    u_28: { lngLat: [5.760, 49.915], status: 'degraded', strength: 52, supply: 55 },
    u_peiper: { lngLat: [5.825, 50.405], status: 'degraded', strength: 78, supply: 32, spotted: true },
    u_12ss: { lngLat: [6.205, 50.448], status: 'engaged', strength: 80, supply: 68, spotted: true },
    u_2pz: { lngLat: [5.525, 50.140], status: 'ready', strength: 88, supply: 60, spotted: true },
    u_lehr: { lngLat: [5.640, 49.965], status: 'engaged', strength: 85, supply: 65, spotted: true },
    u_26vg: { lngLat: [5.785, 50.008], status: 'engaged', strength: 80, supply: 68, spotted: true },
    u_116pz: { lngLat: [5.680, 50.175], status: 'ready', strength: 85, supply: 66, spotted: true },
  });

  // Alternate "What-If" Branch from Turn 1: Peiper captures the Malmedy fuel dump and drives deep!
  const unitsAltT2 = stepUnits(unitsT1, {
    u_peiper: { lngLat: [5.620, 50.455], status: 'ready', strength: 90, supply: 88, spotted: true, notes: 'Captured Malmedy fuel stocks — driving straight toward Liège!' },
    u_2pz: { lngLat: [5.310, 50.215], status: 'ready', strength: 90, supply: 68, spotted: true, notes: 'Approaching Dinant and the Meuse River crossings.' },
    u_101: { lngLat: [5.718, 50.002], status: 'engaged', strength: 84, supply: 50 },
    u_7arm: { lngLat: [6.020, 50.295], status: 'degraded', strength: 60, supply: 55 },
  });

  const graphicsBase = [
    { id: 'g_meuse', type: 'phase', side: 'allies', label: 'PL MEUSE (HOLD LINE)', coords: [[4.91, 50.56], [4.90, 50.36], [4.91, 50.26], [4.86, 50.12]] },
    { id: 'g_axis_main', type: 'axis', side: 'axis', label: '5th Panzer Main Effort', coords: [[6.26, 50.07], [5.92, 50.08], [5.54, 50.14], [5.05, 50.24]] },
    { id: 'g_shoulder', type: 'boundary', side: 'allies', label: 'Northern Shoulder', coords: [[5.95, 50.50], [6.22, 50.47], [6.36, 50.44]] },
  ];

  const linksOpen = { l_liege_elsen: 'open', l_arlon_bast: 'open', l_dinant_bast: 'open', l_bitburg_stvith: 'open', l_bitburg_bast: 'open' };
  const linksEncircled = { l_liege_elsen: 'open', l_arlon_bast: 'cut', l_dinant_bast: 'cut', l_bitburg_stvith: 'degraded', l_bitburg_bast: 'open' };

  return {
    title: 'Battle of the Bulge — Ardennes 1944',
    summary: 'December 1944: Can the 5th & 6th Panzer Armies seize Bastogne and reach the Meuse River before Allied airpower clears the fog and Patton\'s Third Army breaks the siege?',
    map: null,
    view: { center: [5.72, 50.14], zoom: 8.8, bearing: 0, pitch: 28, basemap: 'dark' },
    sides,
    clock: { mode: 'time', stepMinutes: 1440, start: '1944-12-16T06:00' },
    rules: {
      planning: false,
      autoSpot: false,
      auto: true,
      c2Delay: false,
      lossPct: 10,
      resupply: 45,
      reachKm: 8,
      radioKm: 35,
      interdictKm: 4,
    },
    objectives: [
      { id: 'o_bastogne', name: 'Bastogne Crossroads', lngLat: [5.718, 50.002], radiusKm: 5, points: 35, holder: 'allies' },
      { id: 'o_stvith', name: 'St. Vith Road Hub', lngLat: [6.127, 50.281], radiusKm: 5, points: 25, holder: 'allies' },
      { id: 'o_elsenborn', name: 'Elsenborn Ridge', lngLat: [6.205, 50.468], radiusKm: 5, points: 20, holder: 'allies' },
      { id: 'o_dinant', name: 'Meuse Bridge (Dinant)', lngLat: [4.912, 50.261], radiusKm: 6, points: 40, holder: 'allies' },
      { id: 'o_malmedy', name: 'Malmedy Fuel Depot', lngLat: [6.028, 50.427], radiusKm: 4, points: 15, holder: 'allies' },
    ],
    victory: { text: 'Control Bastogne & the Meuse crossings by Dec 26 (75+ pts)', target: 75, mode: 'held' },
    network: {
      nodes: [
        { id: 'n_liege', name: 'Liège Allied Depot', type: 'depot', side: 'allies', lngLat: [5.579, 50.632] },
        { id: 'n_arlon', name: 'Arlon Railhead', type: 'depot', side: 'allies', lngLat: [5.816, 49.683] },
        { id: 'n_bitburg', name: 'Bitburg Panzer Depot', type: 'depot', side: 'axis', lngLat: [6.525, 49.975] },
      ],
      links: [
        { id: 'l_liege_elsen', name: 'Liège–Elsenborn Hwy', type: 'road', side: 'allies', capacity: 100, coords: [[5.579, 50.632], [5.88, 50.52], [6.205, 50.468]] },
        { id: 'l_arlon_bast', name: 'N4 Arlon–Bastogne Road', type: 'road', side: 'allies', capacity: 100, coords: [[5.816, 49.683], [5.76, 49.84], [5.718, 50.002]] },
        { id: 'l_dinant_bast', name: 'Meuse–Bastogne Corridor', type: 'road', side: 'allies', capacity: 80, coords: [[4.912, 50.261], [5.32, 50.16], [5.718, 50.002]] },
        { id: 'l_bitburg_stvith', name: 'Eifel–St. Vith Axis', type: 'road', side: 'axis', capacity: 90, coords: [[6.525, 49.975], [6.38, 50.14], [6.127, 50.281]] },
        { id: 'l_bitburg_bast', name: 'Clervaux–Bastogne Axis', type: 'road', side: 'axis', capacity: 90, coords: [[6.525, 49.975], [6.03, 50.05], [5.718, 50.002]] },
      ],
    },
    injects: [
      {
        id: 'inj_mist',
        title: 'Operation Autumn Mist',
        text: '05:30 — A massive German artillery barrage shatters the quiet Ardennes forest. Freezing fog grounds all Allied fighter-bombers across Belgium.',
        turn: 1,
        lngLat: [6.26, 50.24],
      },
      {
        id: 'inj_nuts',
        title: 'Bastogne Surrounded — "NUTS!"',
        text: '26th Volksgrenadier and Panzer Lehr sever the N4 highway around Bastogne. Asked to surrender, Brig. Gen. Anthony McAuliffe replies with a single word: "NUTS!"',
        turn: 2,
        lngLat: [5.718, 50.002],
      },
      {
        id: 'inj_skies',
        title: 'Clear Winter Skies — Airpower Unleashed!',
        text: 'The freezing fog finally lifts! Allied P-47 Thunderbolts hammer exposed Panzer columns on the roads, and C-47 transports airdrop vital ammunition and medical supplies into Bastogne.',
        turn: 3,
        lngLat: [5.718, 50.002],
      },
      {
        id: 'inj_patton',
        title: 'Patton\'s Relief Column Strikes North',
        text: 'US Third Army\'s 4th Armored Division pivots 90 degrees north from Arlon, driving straight up the N4 highway to shatter the southern ring around Bastogne.',
        turn: null,
        lngLat: [5.75, 49.84],
      },
    ],
    schedule: [
      { id: 'sch_w3', type: 'weather', turn: 3, weather: 'clear' },
      {
        id: 'sch_4arm',
        type: 'arrive',
        turn: 3,
        lngLat: [5.760, 49.810],
        unit: { id: 'u_4arm', name: '4th Armored Div (Patton)', side: 'allies', kind: 'armor', echelon: 'I', strength: 100, status: 'ready', rangeKm: 6, speedKmh: 34, spotted: true, supply: 100, notes: 'Third Army relief spearhead racing north to break the siege of Bastogne!' },
      },
      {
        id: 'sch_p47',
        type: 'arrive',
        turn: 3,
        lngLat: [5.380, 50.040],
        unit: { id: 'u_p47', name: 'IX Tactical Air (P-47s)', side: 'allies', kind: 'aircraft', echelon: 'H', strength: 100, status: 'ready', rangeKm: 22, speedKmh: 90, spotted: true, supply: 100, notes: 'Close air support hunting German armor once the fog clears.' },
      },
      {
        id: 'sch_2arm',
        type: 'arrive',
        turn: 4,
        lngLat: [5.035, 50.235],
        unit: { id: 'u_2arm', name: '2nd Armored Div ("Hell on Wheels")', side: 'allies', kind: 'armor', echelon: 'I', strength: 100, status: 'ready', rangeKm: 6, speedKmh: 32, spotted: true, supply: 100, notes: 'Blocking 2nd Panzer Division at Celles, four miles short of the Meuse!' },
      },
    ],
    branches: [
      {
        id: 'main',
        name: 'Historical Line',
        parent: null,
        forkTurn: 0,
        turns: [
          {
            units: unitsT0,
            events: [{ type: 'note', text: 'Dec 16, 1944 — 250,000 German troops mass behind the Our River under freezing Ardennes fog.' }],
            notes: 'Setup: Allied VIII Corps is spread thin across 85 miles of forested terrain.',
            fired: [],
            links: linksOpen,
            graphics: graphicsBase,
            weather: 'fog',
          },
          {
            units: unitsT1,
            events: [
              { type: 'inject', text: 'Inject released: Operation Autumn Mist' },
              { type: 'move', text: 'KG Peiper breaches the Losheim Gap and drives deep toward Stavelot.' },
              { type: 'move', text: '101st Airborne rushes by truck into Bastogne; 7th Armored digs in at St. Vith.' },
            ],
            notes: 'Dec 17: Northern shoulder at Elsenborn Ridge holds firm, funneling 6th Panzer Army southward.',
            fired: ['inj_mist'],
            links: linksOpen,
            graphics: graphicsBase,
            weather: 'fog',
          },
          {
            units: unitsT2,
            events: [
              { type: 'inject', text: 'Inject released: Bastogne Surrounded — "NUTS!"' },
              { type: 'combat', text: '101st Airborne and 10th Armored repel probing attacks around Bastogne perimeter.' },
              { type: 'move', text: '2nd Panzer Division pushes past Houffalize toward Dinant; KG Peiper runs critically low on fuel.' },
            ],
            notes: 'Dec 19 — Ready to play! Advance to Turn 3 to clear the fog and bring in Patton\'s 4th Armored Div & P-47s, or push 2nd Panzer toward the Meuse!',
            fired: ['inj_mist', 'inj_nuts'],
            links: linksEncircled,
            graphics: graphicsBase,
            weather: 'snow',
          },
        ],
      },
      {
        id: 'alt_peiper',
        name: 'What-If: Peiper Seizes Fuel',
        parent: 'main',
        forkTurn: 1,
        turns: [
          { units: unitsT0, events: [], notes: '', fired: [], links: linksOpen, graphics: graphicsBase, weather: 'fog' },
          { units: unitsT1, events: [], notes: '', fired: ['inj_mist'], links: linksOpen, graphics: graphicsBase, weather: 'fog' },
          {
            units: unitsAltT2,
            events: [
              { type: 'move', text: 'KG Peiper captures intact Allied fuel stocks near Malmedy and surges toward Liège!' },
              { type: 'move', text: '2nd Panzer closes within 18 km of the Meuse Bridge at Dinant.' },
            ],
            notes: 'Alternate branch: Compare against the Historical Line in Branches → Ghost Overlay or Compare Branches!',
            fired: ['inj_mist'],
            links: linksEncircled,
            graphics: graphicsBase,
            weather: 'fog',
          },
        ],
      },
    ],
  };
}
