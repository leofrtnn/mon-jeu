/**
 * Génération procédurale de noms crédibles (joueurs et clubs fictifs).
 * Plusieurs "origines" pour un championnat cosmopolite.
 */

const ORIGINS = [
  { w: 40, first: ['Lucas','Hugo','Théo','Nathan','Louis','Maxime','Antoine','Julien','Romain','Kylian','Adrien','Baptiste','Clément','Florian','Quentin','Valentin','Mathis','Enzo','Raphaël','Benjamin','Yanis','Mehdi','Bastien','Corentin','Dylan','Kévin','Jordan','Loïc','Thibault','Gaëtan','Rémi','Alexis','Matthieu','Sacha','Noah','Evan','Tom','Arthur','Malo','Léo'],
    last: ['Martin','Bernard','Dubois','Durand','Lefèvre','Moreau','Laurent','Simon','Michel','Garnier','Faure','Rousseau','Blanc','Guérin','Muller','Henry','Roussel','Nicolas','Perrin','Morin','Mathieu','Clément','Gauthier','Dumont','Lopez','Fontaine','Chevalier','Robin','Masson','Sanchez','Gérard','Nguyen','Boyer','Denis','Lemaire','Duval','Joly','Gautier','Roger','Roche','Roy','Noël','Meyer','Lucas','Meunier','Jean','Pérez','Marchand','Dufour','Blanchard','Barbier','Brun','Dumas','Brunet','Schmitt','Leroux','Colin','Fernandez','Pierre','Renard','Arnaud','Rolland','Caron','Aubert','Giraud','Leclerc','Vidal','Bourgeois','Renaud','Lemoine','Picard','Gaillard','Philippe','Leclercq','Lacroix','Fabre','Dupuis','Olivier','Rodriguez','Da Costa','Hubert','Carpentier','Deschamps','Marechal','Vasseur','Tessier','Lebrun','Besnard','Pasquier','Delmas'] },
  { w: 14, first: ['Moussa','Ibrahima','Mamadou','Cheikh','Ousmane','Sékou','Abdoulaye','Bakary','Seydou','Amadou','Youssouf','Lamine','Idrissa','Boubacar','Souleymane','Kalidou','Ismaïla','Pape','Aliou','Modibo'],
    last: ['Diallo','Traoré','Koné','Diop','Ndiaye','Camara','Touré','Keïta','Sow','Cissé','Fofana','Bamba','Sylla','Sissoko','Coulibaly','Diarra','Konaté','Kanté','Gueye','Mendy','Sarr','Faye','Dembélé','Doucouré','Sangaré','Bakayoko','Kouyaté','Niang','Tall','Barry'] },
  { w: 12, first: ['Diego','Pablo','Sergio','Álvaro','Javier','Iker','Rodrigo','Marcos','Raúl','Iván','Rafael','Tiago','João','Bruno','Diogo','Rúben','Gonçalo','Nuno','André','Pedro'],
    last: ['García','Martínez','López','Sánchez','Romero','Navarro','Ortega','Delgado','Castro','Morales','Iglesias','Moreno','Silva','Santos','Ferreira','Pereira','Oliveira','Costa','Carvalho','Almeida','Sousa','Ribeiro','Gomes','Marques','Pinto','Teixeira'] },
  { w: 8, first: ['Gabriel','Matheus','Vinícius','Thiago','Felipe','Caio','Rafinha','Igor','Wesley','Danilo','Éverton','Renan'],
    last: ['Souza','Lima','Araújo','Barbosa','Rocha','Cardoso','Nascimento','Mendes','Freitas','Monteiro','Batista','Moura','Vieira','Correia'] },
  { w: 8, first: ['Luka','Marko','Ivan','Nikola','Stefan','Milan','Dusan','Filip','Petar','Bojan','Andrej','Mateo'],
    last: ['Petrović','Jovanović','Marković','Kovačević','Babić','Horvat','Novak','Popović','Nikolić','Ilić','Stanković','Vidović','Lukić','Perić'] },
  { w: 8, first: ['Youssef','Achraf','Hakim','Karim','Sofiane','Ilyes','Riyad','Nabil','Amine','Bilal','Rayan','Walid'],
    last: ['Benali','Haddad','Mansouri','Belkacem','Bensaïd','Amrani','Boudjema','Zerrouki','Chaïbi','Kaddour','Tahiri','Brahimi','Slimani','Hamdi'] },
  { w: 6, first: ['Lars','Erik','Jonas','Mikkel','Emil','Oskar','Niklas','Lukas','Jan','Tim','Kai','Finn'],
    last: ['Hansen','Larsen','Nielsen','Johansson','Lindqvist','Berg','Schneider','Fischer','Weber','Becker','Wagner','Hoffmann','De Vries','Jansen','Peeters','Janssens'] },
  { w: 4, first: ['Marco','Luca','Federico','Andrea','Lorenzo','Matteo','Davide','Simone'],
    last: ['Rossi','Russo','Ferrari','Esposito','Bianchi','Romano','Colombo','Ricci','Marino','Greco','Conti','De Luca'] },
];
const ORIGIN_WEIGHTS = ORIGINS.map((o) => o.w);

/** Retourne { first, last } crédible. */
export function randomName(rng) {
  const o = ORIGINS[rng.weightedIndex(ORIGIN_WEIGHTS)];
  // De temps en temps, prénom et nom d'origines différentes (binationaux).
  const o2 = rng.chance(0.12) ? ORIGINS[rng.weightedIndex(ORIGIN_WEIGHTS)] : o;
  return { first: rng.pick(o.first), last: rng.pick(o2.last) };
}

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
