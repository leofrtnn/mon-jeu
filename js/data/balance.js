/**
 * ÉQUILIBRAGE — toutes les valeurs numériques des systèmes « vie du club »
 * (presse, vestiaire, propriétaires, relations, finances, supporters, sponsors,
 * blessures, agents, offres d'emploi). Modifier ce fichier suffit à rééquilibrer.
 *
 * Unité de temps : une « journée » du calendrier ≈ une semaine.
 * Les moraux / confiances sont sur 0-100.
 */
export const BAL = {
  /* ---------- Moral & personnalités ---------- */
  morale: {
    base: 56,          // valeur vers laquelle le moral revient lentement
    revert: 0.05,      // part de l'écart rattrapée chaque journée
    min: 5, max: 99,
  },
  personalities: {
    // poids = fréquence ; sens = sensibilité aux variations de moral ;
    // req = propension à faire des demandes ; leak = propension à parler à la presse
    leader:    { label: 'Leader',     weight: 0.12, sens: 0.8, req: 0.8, leak: 0.3, infl: 25 },
    ambitious: { label: 'Ambitieux',  weight: 0.20, sens: 1.0, req: 1.4, leak: 0.5, infl: 5 },
    loyal:     { label: 'Loyal',      weight: 0.22, sens: 0.7, req: 0.6, leak: 0.15, infl: 8 },
    mercenary: { label: 'Mercenaire', weight: 0.14, sens: 0.9, req: 1.5, leak: 0.6, infl: 0 },
    sensitive: { label: 'Sensible',   weight: 0.20, sens: 1.5, req: 1.0, leak: 0.35, infl: 0 },
    rebel:     { label: 'Rebelle',    weight: 0.12, sens: 1.2, req: 1.3, leak: 0.85, infl: 10 },
  },

  /* ---------- 3. Vestiaire ---------- */
  dressing: {
    coreSize: 4,        // nombre de leaders formant le noyau
    unhappy: 38,        // un leader sous ce moral contamine ses proches
    happy: 68,          // au-dessus, il peut apaiser le groupe
    spread: 0.09,       // force de contagion (× influence/100 × affinité)
    calm: 0.07,         // force d'apaisement
    affinity: { nat: 1, age: 0.6, tenure: 0.5, base: 0.25 },
    confSmoothing: 0.25, // lissage de la confiance du vestiaire envers le coach
    crisisLossStreak: 3, // défaites d'affilée déclenchant la réunion de crise
    clashChance: 0.035,  // par journée, si deux joueurs rebelles/mécontents
    captainChance: 0.12, // le capitaine prend la parole après une défaite
  },

  /* ---------- 4. Demandes des joueurs ---------- */
  requests: {
    baseChance: 0.012,   // par joueur et par journée (× personnalité × moral)
    minMatches: 5,       // pas de demande de temps de jeu avant 5 matchs
    deadline: [2, 3],    // journées (≈ semaines) pour répondre
    publicBoard: -5,     // impact d'une sortie publique sur la confiance du board
    publicDressing: -6,  // … et du vestiaire
    publicMedia: -2,
    refuseMorale: -8,
    promiseMorale: 7,
    promiseCheckDays: 6, // la promesse est vérifiée 6 journées plus tard
    promiseKept: 6, promiseBroken: -14,
    maxOpen: 2,          // demandes ouvertes simultanées au maximum
  },

  /* ---------- 1-2. Presse ---------- */
  press: {
    // Effets de base par style de réponse : moral équipe, joueur visé, board,
    // supporters, réputation médias, tension avec l'adversaire (+ = plus hostile).
    styles: {
      humble:  { team: 1,   target: 1, board: 1.5,  fans: 0.5,  media: 2,    rival: -2 },
      fighter: { team: 3,   target: 0, board: -0.8, fans: 2.5,  media: 0,    rival: 8 },
      protect: { team: 2,   target: 6, board: -0.3, fans: 0.8,  media: 0.5,  rival: 0 },
      evasive: { team: 0,   target: 0, board: 0,    fans: -1,   media: -1.5, rival: 0 },
    },
    // Ajustements selon le résultat du match.
    context: {
      loss: { humble: { board: 1, fans: -0.5 }, fighter: { board: -1.5, fans: 1 }, evasive: { media: -1 } },
      win: { fighter: { fans: 1, rival: 3 }, humble: { media: 0.5 } },
    },
    journalists: {
      kind:      { label: 'bienveillant',     mag: 0.7, risk: 0.4, viral: 0.5 },
      neutral:   { label: 'neutre',           mag: 1.0, risk: 1.0, viral: 1.0 },
      trap:      { label: 'piégeur',          mag: 1.2, risk: 1.7, viral: 1.1 },
      tabloid:   { label: 'sensationnaliste', mag: 1.4, risk: 1.3, viral: 2.0 },
    },
    backfire: 0.12,       // risque de base qu'une réponse combative/évasive se retourne
    fatigue: 0.8,         // multiplicateur par réponse identique parmi les dernières
    fatigueWindow: 6,
    viralBase: 0.1,       // chance qu'une réponse combative devienne virale
    viralWeeks: [2, 3],
    viralDaily: 0.35,     // part des effets rejouée chaque journée de buzz
    rivalReply: 0.6,      // chance qu'un entraîneur rival réponde à un clip viral
    noAnswerMedia: -1.5,  // « Ne pas répondre » (choix explicite)
    ignoredMedia: -0.3,   // interview ignorée : l'attaché de presse répond à votre place
    statementsKept: 30,
    trustWindow: 2,       // matchs pour vérifier « je fais confiance à X »
    liePenalty: { media: -4, dressing: -4, target: -10 },
    keptBonus: { media: 2, dressing: 2, target: 4 },
    preMatchOpp: 4,       // motivation adverse max (talk) après une provocation
    talkClamp: 12,
    mediaRevert: 0.03,    // la réputation médias revient lentement vers 50
    fansRevert: 0.025,    // l'humeur des supporters revient lentement vers 55
  },

  /* ---------- 5. Propriétaires ---------- */
  owners: {
    takeoverRate: 0.085,  // probabilité de base par club et par saison
    distressMult: 3.5,    // multiplicateur pour un club en difficulté financière
    types: {
      // drain : part de la trésorerie positive dépensée / retirée chaque journée (clubs IA)
      ambitious: { label: 'Ambitieux',    weight: 0.2,  budget: 1.45, wage: 1.15, patience: 0.75, target: -1, fans: 2,  drain: 0.02 },
      patron:    { label: 'Mécène',       weight: 0.15, budget: 1.35, wage: 1.15, patience: 1.3,  target: 0,  fans: 4,  drain: 0.006 },
      manager:   { label: 'Gestionnaire', weight: 0.3,  budget: 0.95, wage: 1.0,  patience: 1.0,  target: 0,  fans: -1, drain: 0.004 },
      speculator:{ label: 'Spéculateur',  weight: 0.15, budget: 0.8,  wage: 0.95, patience: 0.9,  target: 0,  fans: -6, drain: 0.03 },
      local:     { label: 'Fan local',    weight: 0.2,  budget: 0.85, wage: 0.95, patience: 1.4,  target: 1,  fans: 6,  drain: 0.012 },
    },
    injection: 0.35,      // apport du nouveau propriétaire (× budget de référence)
    sackRepThreshold: 45, // réputation sous laquelle un nouveau propriétaire peut vous renvoyer
    sackChance: 0.45,
    freeHandRep: 70,      // au-dessus : carte blanche (+budget)
    multiClub: 0.12,      // part des rachats par un groupe déjà propriétaire d'un club
  },

  /* ---------- 6-7. Rivaux & relations ---------- */
  relations: {
    decay: 0.03,          // part de l'écart à la base rattrapée par journée
    derbyBase: -22, derbyInit: -35, sameOwnerBase: 25,
    friendly: 40, hostile: -40, blocked: -75, ally: 50,
    fairSale: 5, stolen: -12, clause: -15, loan: 4, interview: -8,
    closeMatch: -2, redMatch: -3, viral: -10,
    priceFriendly: 0.9, priceHostile: 1.35,
    tensionMax: 1.25,     // cartons / fautes en plus dans un match tendu
    aiClashChance: 0.25,  // par journée : une petite guerre médiatique entre clubs IA
  },
  rivals: {
    priceMult: [1.3, 2.0],   // surcoût quand la vente renforcerait trop un concurrent
    untouchableMult: 2.5,    // offre exceptionnelle exigée pour un intouchable
    intermediaryFee: 0.12,   // commission d'un club intermédiaire
    intermediaryCaught: 0.3, // risque que la manœuvre soit éventée
    directGap: 3,            // places d'écart au classement = concurrent direct
  },

  /* ---------- 8. Finances ---------- */
  crisis: {
    // santé = 50 + semaines de salaires en caisse (bornées) × weeksScale
    //        + (équilibre d'exploitation - référence) × flowWeight
    weeksScale: 1, weeksClamp: [-25, 40],
    flowRef: -0.22,       // déficit d'exploitation « normal » (primes et droits TV comblent l'écart)
    flowWeight: 100,
    threshold: 30,        // sous ce seuil : crise
    bankrupt: 10,         // sous ce seuil : faillite (retrait de points)
    discount: 0.75, deadlineDiscount: 0.6,
    pointsPenalty: 6,
    negativeCarry: 0.7,   // part d'une dette conservée d'une saison à l'autre (IA)
  },

  /* ---------- 10. Agents & rumeurs ---------- */
  agents: {
    minValue: 900000,
    types: {
      greedy:     { label: 'gourmand', weight: 0.4, wage: 1.12, fee: 0.09, bonusWeeks: 10 },
      loyal:      { label: 'loyal',    weight: 0.3, wage: 1.0,  fee: 0.04, bonusWeeks: 0 },
      aggressive: { label: 'agressif', weight: 0.3, wage: 1.06, fee: 0.06, bonusWeeks: 4, leak: 0.3 },
    },
  },
  rumours: { daily: 0.45, closedDaily: 0.15, trueRate: 0.7, agentShare: 0.3, destabilize: 6, hypeWeeks: 4, hype: 1.1 },

  /* ---------- 11. Deadline day ---------- */
  deadline: { seconds: 120, every: [6, 10], surpriseIn: 0.35, bargain: 0.3, lateRefusal: 0.25 },

  /* ---------- 12. Supporters ---------- */
  fans: {
    win: 3, draw: 0, loss: -3.5, bigWin: 1.2, revert: 0.06,
    ticket: { low: { price: 0.8, atm: 0.6 }, normal: { price: 1, atm: 0 }, high: { price: 1.25, atm: -0.9 } },
    homeAdv: [1.01, 1.042],      // avantage domicile selon l'ambiance (0 → 100)
    revenue: [0.8, 1.15],        // multiplicateur de billetterie selon l'ambiance
    boardPressure: 30,           // sous ce seuil, le board s'inquiète
    favouriteSold: -8,
  },

  /* ---------- 13. Sponsors ---------- */
  sponsors: {
    baseShare: 0.5,       // part des revenus sponsors « historiques » conservée
    winBonus: 0.15,       // prime de victoire (× versement hebdo)
    leaveSat: 20, leaveImage: 25, leaveChance: 0.35,
    satRevert: 0.04,      // la satisfaction revient vers 55 sans événement
    reqGood: 2, reqBad: -4, // effet d'une exigence tenue / non tenue (contrôle toutes les 3 journées)
    starShare: 0.6,       // exigence « titulariser la star »
    primetimeFatigue: 4,
  },

  /* ---------- 14. Blessures ---------- */
  injuries: {
    longThreshold: 6,     // matchs : au-delà, blessure longue
    severeChance: 0.06, severe: [12, 30],
    earlyReturnAt: 0.35,  // proposition de retour anticipé à 35 % de la durée restante
    relapseBase: 0.35, relapseMatches: 3, relapseMult: 1.5,
    physioCut: 0.03,      // par point de note du médecin
    longMorale: -0.8,     // par journée d'absence longue
  },

  /* ---------- 15. Offres d'emploi ---------- */
  jobs: { every: 6, leaveRep: -4, leaveFans: 45, refuseBoard: 4, refuseFans: 3, refuseDressing: 2 },
};
