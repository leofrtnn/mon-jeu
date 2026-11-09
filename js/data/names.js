/**
 * Génération procédurale de noms crédibles (joueurs et clubs fictifs).
 * Plusieurs "origines" pour un championnat cosmopolite.
 */

const ORIGINS = [
  { w: 40, key: 'fr', nations: ['France', 'France', 'France', 'Belgique', 'Suisse'], first: ['Lucas','Hugo','Théo','Nathan','Louis','Maxime','Antoine','Julien','Romain','Kylian','Adrien','Baptiste','Clément','Florian','Quentin','Valentin','Mathis','Enzo','Raphaël','Benjamin','Yanis','Mehdi','Bastien','Corentin','Dylan','Kévin','Jordan','Loïc','Thibault','Gaëtan','Rémi','Alexis','Matthieu','Sacha','Noah','Evan','Tom','Arthur','Malo','Léo'],
    last: ['Martin','Bernard','Dubois','Durand','Lefèvre','Moreau','Laurent','Simon','Michel','Garnier','Faure','Rousseau','Blanc','Guérin','Muller','Henry','Roussel','Nicolas','Perrin','Morin','Mathieu','Clément','Gauthier','Dumont','Lopez','Fontaine','Chevalier','Robin','Masson','Sanchez','Gérard','Nguyen','Boyer','Denis','Lemaire','Duval','Joly','Gautier','Roger','Roche','Roy','Noël','Meyer','Lucas','Meunier','Jean','Pérez','Marchand','Dufour','Blanchard','Barbier','Brun','Dumas','Brunet','Schmitt','Leroux','Colin','Fernandez','Pierre','Renard','Arnaud','Rolland','Caron','Aubert','Giraud','Leclerc','Vidal','Bourgeois','Renaud','Lemoine','Picard','Gaillard','Philippe','Leclercq','Lacroix','Fabre','Dupuis','Olivier','Rodriguez','Da Costa','Hubert','Carpentier','Deschamps','Marechal','Vasseur','Tessier','Lebrun','Besnard','Pasquier','Delmas'] },
  { w: 14, key: 'waf', nations: ['Sénégal', 'Mali', 'Côte d\'Ivoire', 'Guinée', 'Cameroun'], first: ['Moussa','Ibrahima','Mamadou','Cheikh','Ousmane','Sékou','Abdoulaye','Bakary','Seydou','Amadou','Youssouf','Lamine','Idrissa','Boubacar','Souleymane','Kalidou','Ismaïla','Pape','Aliou','Modibo'],
    last: ['Diallo','Traoré','Koné','Diop','Ndiaye','Camara','Touré','Keïta','Sow','Cissé','Fofana','Bamba','Sylla','Sissoko','Coulibaly','Diarra','Konaté','Kanté','Gueye','Mendy','Sarr','Faye','Dembélé','Doucouré','Sangaré','Bakayoko','Kouyaté','Niang','Tall','Barry'] },
  { w: 12, key: 'ibe', nations: ['Espagne', 'Espagne', 'Portugal'], first: ['Diego','Pablo','Sergio','Álvaro','Javier','Iker','Rodrigo','Marcos','Raúl','Iván','Rafael','Tiago','João','Bruno','Diogo','Rúben','Gonçalo','Nuno','André','Pedro'],
    last: ['García','Martínez','López','Sánchez','Romero','Navarro','Ortega','Delgado','Castro','Morales','Iglesias','Moreno','Silva','Santos','Ferreira','Pereira','Oliveira','Costa','Carvalho','Almeida','Sousa','Ribeiro','Gomes','Marques','Pinto','Teixeira'] },
  { w: 8, key: 'bra', nations: ['Brésil'], first: ['Gabriel','Matheus','Vinícius','Thiago','Felipe','Caio','Rafinha','Igor','Wesley','Danilo','Éverton','Renan'],
    last: ['Souza','Lima','Araújo','Barbosa','Rocha','Cardoso','Nascimento','Mendes','Freitas','Monteiro','Batista','Moura','Vieira','Correia'] },
  { w: 8, key: 'bal', nations: ['Croatie', 'Serbie'], first: ['Luka','Marko','Ivan','Nikola','Stefan','Milan','Dusan','Filip','Petar','Bojan','Andrej','Mateo'],
    last: ['Petrović','Jovanović','Marković','Kovačević','Babić','Horvat','Novak','Popović','Nikolić','Ilić','Stanković','Vidović','Lukić','Perić'] },
  { w: 8, key: 'mag', nations: ['Maroc', 'Algérie', 'Tunisie'], first: ['Youssef','Achraf','Hakim','Karim','Sofiane','Ilyes','Riyad','Nabil','Amine','Bilal','Rayan','Walid'],
    last: ['Benali','Haddad','Mansouri','Belkacem','Bensaïd','Amrani','Boudjema','Zerrouki','Chaïbi','Kaddour','Tahiri','Brahimi','Slimani','Hamdi'] },
  { w: 6, key: 'nor', nations: ['Allemagne', 'Pays-Bas', 'Danemark', 'Suède'], first: ['Lars','Erik','Jonas','Mikkel','Emil','Oskar','Niklas','Lukas','Jan','Tim','Kai','Finn'],
    last: ['Hansen','Larsen','Nielsen','Johansson','Lindqvist','Berg','Schneider','Fischer','Weber','Becker','Wagner','Hoffmann','De Vries','Jansen','Peeters','Janssens'] },
  { w: 4, key: 'ita', nations: ['Italie'], first: ['Marco','Luca','Federico','Andrea','Lorenzo','Matteo','Davide','Simone'],
    last: ['Rossi','Russo','Ferrari','Esposito','Bianchi','Romano','Colombo','Ricci','Marino','Greco','Conti','De Luca'] },
  { w: 0, key: 'eng', nations: ['Angleterre', 'Angleterre', 'Écosse', 'Irlande', 'Pays de Galles'], first: ['Jack','Harry','Oliver','George','Charlie','James','Thomas','William','Callum','Liam','Connor','Ryan','Declan','Mason','Kieran','Jamie','Owen','Reece','Aaron','Ben','Sam','Joe'],
    last: ['Smith','Jones','Taylor','Brown','Wilson','Evans','Walker','Wright','Robinson','Thompson','White','Hughes','Edwards','Green','Hall','Wood','Harris','Clarke','Jackson','Turner','Hill','Cooper','Ward','Murphy','Kelly','O\'Brien','McKenzie','Fletcher','Barnes','Holloway','Pearce','Whitfield','Ashworth','Kershaw'] },
];

/** Pondération des origines selon le pays du club. */
const COUNTRY_WEIGHTS = {
  FRA: { fr: 40, waf: 14, ibe: 6, bra: 6, bal: 6, mag: 9, nor: 5, ita: 3, eng: 2 },
  IBE: { fr: 5, waf: 7, ibe: 50, bra: 16, bal: 5, mag: 6, nor: 4, ita: 5, eng: 2 },
  ALB: { fr: 5, waf: 12, ibe: 6, bra: 5, bal: 6, mag: 3, nor: 10, ita: 3, eng: 50 },
  // Monde réel
  ENG: { fr: 5, waf: 12, ibe: 6, bra: 5, bal: 6, mag: 3, nor: 10, ita: 3, eng: 50 },
  ESP: { fr: 5, waf: 7, ibe: 50, bra: 16, bal: 5, mag: 6, nor: 4, ita: 5, eng: 2 },
  ITA: { fr: 5, waf: 8, ibe: 6, bra: 10, bal: 10, mag: 4, nor: 5, ita: 50, eng: 2 },
  GER: { fr: 6, waf: 9, ibe: 4, bra: 5, bal: 14, mag: 6, nor: 50, ita: 3, eng: 3 },
  POR: { fr: 4, waf: 10, ibe: 50, bra: 25, bal: 4, mag: 3, nor: 3, ita: 2, eng: 1 },
  NED: { fr: 4, waf: 10, ibe: 4, bra: 5, bal: 6, mag: 12, nor: 55, ita: 2, eng: 3 },
  BEL: { fr: 30, waf: 14, ibe: 4, bra: 4, bal: 6, mag: 10, nor: 30, ita: 3, eng: 2 },
  TUR: { fr: 3, waf: 8, ibe: 4, bra: 8, bal: 30, mag: 30, nor: 6, ita: 3, eng: 2 },
  CZE: { fr: 2, waf: 6, ibe: 2, bra: 3, bal: 55, mag: 2, nor: 25, ita: 2, eng: 2 },
};

/** Retourne { first, last, nat } crédible pour un club du pays donné. */
export function randomName(rng, country = 'FRA') {
  const cw = COUNTRY_WEIGHTS[country] || COUNTRY_WEIGHTS.FRA;
  const weights = ORIGINS.map((o) => cw[o.key] ?? o.w);
  const o = ORIGINS[rng.weightedIndex(weights)];
  // De temps en temps, prénom et nom d'origines différentes (binationaux).
  const o2 = rng.chance(0.12) ? ORIGINS[rng.weightedIndex(weights)] : o;
  return { first: rng.pick(o.first), last: rng.pick(o2.last), nat: rng.pick(o.nations) };
}

/** Villes fictives d'Ibérie et d'Albion. */
export const CITIES_IBE = ['Valdemora', 'Castrillo', 'San Lorián', 'Albacena', 'Puerto Riel', 'Montealto', 'Villafría', 'Torrevieja Alta', 'Santa Olalla',
  'Almoria', 'Calarrosa', 'Ourense Nova', 'Vilaflor', 'Benavira', 'Las Garzas', 'Peñarroja', 'Mirandela', 'Cortegana', 'Sotoluz', 'Fuenclara', 'Alcorán', 'Navalmar'];
export const CITIES_ALB = ['Ashbury', 'Kingsmoor', 'Holloway', 'Bramford', 'Eastcliff', 'Whitmore', 'Redbridge Vale', 'Stockley', 'Harrowgate', 'Millbrook',
  'Thornbury', 'Westhaven', 'Coldmere', 'Bexford', 'Langdale', 'Fairhurst', 'Northwick', 'Crowley', 'Saltmarsh', 'Ravenscar', 'Oakham Port', 'Dunmore'];
const PATTERNS = {
  IBE: ['Real {c}', 'Atlético {c}', 'CD {c}', 'Sporting {c}', 'UD {c}', '{c} CF', 'Racing {c}', 'Deportivo {c}', 'SD {c}', 'Unión {c}'],
  ALB: ['{c} United', '{c} City', '{c} Rovers', '{c} Athletic', '{c} Town', '{c} Wanderers', 'AFC {c}', '{c} Albion', '{c} County', 'Real {c} FC'],
};

/** Nom de club dans le style du pays. */
export function clubNameFor(rng, city, country) {
  if (country === 'FRA') return clubName(rng, city);
  const name = rng.pick(PATTERNS[country]).replace('{c}', city);
  const letters = city.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase();
  return { name, short: (letters[0] + letters[2] + letters[letters.length - 1]).slice(0, 3) };
}

/** Couleurs des sélections nationales (accent, secondaire). */
export const NATION_COLORS = {
  France: ['#1d3fbb', '#ffffff'], Belgique: ['#c8102e', '#fdda24'], Suisse: ['#d52b1e', '#ffffff'], Sénégal: ['#00853f', '#fdef42'],
  Mali: ['#14b53a', '#fcd116'], "Côte d'Ivoire": ['#f77f00', '#ffffff'], Guinée: ['#ce1126', '#fcd116'], Cameroun: ['#007a5e', '#fcd116'],
  Espagne: ['#c60b1e', '#ffc400'], Portugal: ['#8b0000', '#006600'], Brésil: ['#ffdf00', '#009c3b'], Croatie: ['#ff0000', '#ffffff'],
  Serbie: ['#c6363c', '#0c4076'], Maroc: ['#c1272d', '#006233'], Algérie: ['#ffffff', '#006633'], Tunisie: ['#e70013', '#ffffff'],
  Allemagne: ['#ffffff', '#000000'], 'Pays-Bas': ['#ff6f00', '#ffffff'], Danemark: ['#c60c30', '#ffffff'], Suède: ['#fecc00', '#006aa7'],
  Italie: ['#0066cc', '#ffffff'], Angleterre: ['#ffffff', '#cf081f'], Écosse: ['#0065bd', '#ffffff'], Irlande: ['#169b62', '#ffffff'],
  'Pays de Galles': ['#c8102e', '#00b140'],
};

/** Villes fictives (consonance francophone). */
export const CITIES = [
  'Valmont','Brévannes','Rivemont','Saint-Aubert','Port-Marel','Montclair','Belcastel','Sorvignac','Hautefort','Lanvaux',
  'Corbelin','Fréville','Aubrac-sur-Mer','Mirande','Castelroc','Villenoir','Kervallec','Pontivy-les-Bains','Roche-Blanche','Saint-Évrard',
  'Marvejac','Lorvane','Bellerive','Grandpré','Ostrevent','Clairvaux','Montbrison-le-Haut','Vallorcine','Arbois-Neuf','Douvrin',
  'Saint-Galmier','Teyssac','Courvoisy','Verlhac','Mornay','Aiguerande','Lussac-Plage','Champlitte','Sablonnet','Ferrensac',
  'Noirval','Pierrecourt','Beaulac','Gironval',
];
const PREFIXES = ['FC', 'AS', 'Olympique', 'Racing', 'Stade', 'US', 'SC', 'AC', 'Union', 'Sporting', 'Athletic', 'Entente', 'Red Star', 'Girondins', 'ES'];

/** Nom de club et abréviation à 3 lettres. */
export function clubName(rng, city) {
  const p = rng.pick(PREFIXES);
  let name;
  if (p === 'Olympique' || p === 'Stade' || p === 'Racing' || p === 'Sporting') name = `${p} ${/^[AEIOUÉ]/.test(city) ? "d'" : 'de '}${city}`;
  else if (p === 'Athletic' || p === 'Red Star') name = `${city} ${p}`;
  else name = `${p} ${city}`;
  const letters = city.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase();
  const short = (letters[0] + letters[2] + letters[letters.length - 1]).slice(0, 3);
  return { name, short };
}

/** Couleurs de club (accent + secondaire). */
export const CLUB_COLORS = [
  ['#e63946', '#ffffff'], ['#1d6fe0', '#ffffff'], ['#f4c430', '#14213d'], ['#2a9d8f', '#ffffff'], ['#8338ec', '#ffffff'],
  ['#ff7f11', '#1b1b1b'], ['#06d6a0', '#073b4c'], ['#ef476f', '#ffffff'], ['#118ab2', '#ffd166'], ['#9b2226', '#e9d8a6'],
  ['#3a86ff', '#ffbe0b'], ['#80b918', '#ffffff'], ['#d00000', '#ffba08'], ['#00a6fb', '#051923'], ['#ff006e', '#ffffff'],
  ['#5e60ce', '#ffffff'], ['#e9c46a', '#264653'], ['#43aa8b', '#f9c74f'], ['#c1121f', '#003049'], ['#7209b7', '#f72585'],
  ['#0ead69', '#ffffff'], ['#fb5607', '#ffffff'], ['#4361ee', '#ffffff'], ['#b5179e', '#ffffff'], ['#f15bb5', '#00bbf9'],
  ['#2b9348', '#ffffff'], ['#d62828', '#f77f00'], ['#00b4d8', '#03045e'], ['#ffb703', '#023047'], ['#6a4c93', '#ffca3a'],
  ['#e76f51', '#264653'], ['#38b000', '#004b23'], ['#ff595e', '#1982c4'], ['#4cc9f0', '#3a0ca3'], ['#bc4749', '#f2e8cf'],
  ['#3d5a80', '#ee6c4d'], ['#f94144', '#577590'], ['#90be6d', '#277da1'], ['#ffd60a', '#003566'], ['#9d4edd', '#ffffff'],
];
