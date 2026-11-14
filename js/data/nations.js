/**
 * NATIONS : noms français normalisés, drapeaux et confédérations.
 * Certaines pages sources donnent la nationalité en anglais (« BRAZIL ») ou en code (« SER ») :
 * fixNat ramène tout au nom français utilisé par le jeu.
 */
const FIX = {
  SER: 'Serbie', SLO: 'Slovénie', SPA: 'Espagne', KVX: 'Kosovo', NGR: 'Nigeria', CAF: 'Centrafrique', CUR: 'Curaçao', JAP: 'Japon',
  DRC: 'RD Congo', ROM: 'Roumanie', SWI: 'Suisse', CHE: 'Suisse', DNK: 'Danemark', TTO: 'Trinité-et-Tobago', GMB: 'Gambie', BRAZIL: 'Brésil',
  COLOMBIA: 'Colombie', ARGENTINA: 'Argentine', URUGUAY: 'Uruguay', ECUADOR: 'Équateur', GUINEA: 'Guinée', VENEZUELA: 'Venezuela', MOROCCO: 'Maroc',
  PANAMA: 'Panama', ANGOLA: 'Angola', PORTUGAL: 'Portugal', BELGIUM: 'Belgique', CHILE: 'Chili', SPAIN: 'Espagne', ITALY: 'Italie', PARAGUAY: 'Paraguay',
  BOLIVIA: 'Bolivie', GIN: 'Guinée', SUD: 'Soudan', GBS: 'Guinée-Bissau', YEM: 'Yémen', LIT: 'Lituanie', JAPAN: 'Japon', SYRIA: 'Syrie',
  MALAYSIA: 'Malaisie', AUSTRALIA: 'Australie', SLV: 'Salvador', COG: 'Congo', CAR: 'Centrafrique', MLD: 'Moldavie', LAT: 'Lettonie', GHANA: 'Ghana',
  TGO: 'Togo', TOGO: 'Togo', HKG: 'Hong Kong', BHR: 'Bahreïn', BOTSWANA: 'Botswana', FRANCE: 'France', NETHERLANDS: 'Pays-Bas', SENEGAL: 'Sénégal',
  ENGLAND: 'Angleterre', GERMANY: 'Allemagne', PERU: 'Pérou', PRY: 'Paraguay', CRI: 'Costa Rica', CHL: 'Chili', EGYPT: 'Égypte', PSE: 'Palestine',
  MRT: 'Mauritanie', NIGERIA: 'Nigeria', ESW: 'Eswatini', PHL: 'Philippines', TPE: 'Taïwan', SGP: 'Singapour', BAN: 'Bangladesh', FIJ: 'Fidji',
  TJK: 'Tadjikistan', TKM: 'Turkménistan', LCA: 'Sainte-Lucie', BRB: 'Barbade', VAN: 'Vanuatu', VIN: 'Saint-Vincent-et-les-Grenadines', GRL: 'Groenland',
};
export const fixNat = (n) => (n ? FIX[n] || n : n);

/** Code ISO 3166 (2 lettres) pour le drapeau ; Angleterre, Écosse, Pays de Galles ont leur drapeau propre. */
const ISO = {
  France: 'FR', Espagne: 'ES', Allemagne: 'DE', Italie: 'IT', Portugal: 'PT', 'Pays-Bas': 'NL', Belgique: 'BE', Suisse: 'CH', Autriche: 'AT',
  Danemark: 'DK', Suède: 'SE', Norvège: 'NO', Finlande: 'FI', Islande: 'IS', Irlande: 'IE', 'Irlande du Nord': 'GB', Pologne: 'PL', Tchéquie: 'CZ',
  Slovaquie: 'SK', Hongrie: 'HU', Roumanie: 'RO', Bulgarie: 'BG', Serbie: 'RS', Croatie: 'HR', Slovénie: 'SI', 'Bosnie-Herzégovine': 'BA',
  Monténégro: 'ME', 'Macédoine du Nord': 'MK', Albanie: 'AL', Kosovo: 'XK', Grèce: 'GR', Turquie: 'TR', Chypre: 'CY', Israël: 'IL', Ukraine: 'UA',
  Russie: 'RU', Biélorussie: 'BY', Moldavie: 'MD', Géorgie: 'GE', Arménie: 'AM', Azerbaïdjan: 'AZ', Kazakhstan: 'KZ', Lituanie: 'LT', Lettonie: 'LV',
  Estonie: 'EE', Luxembourg: 'LU', Malte: 'MT', 'Îles Féroé': 'FO', Brésil: 'BR', Argentine: 'AR', Uruguay: 'UY', Colombie: 'CO', Chili: 'CL',
  Équateur: 'EC', Pérou: 'PE', Paraguay: 'PY', Bolivie: 'BO', Venezuela: 'VE', Mexique: 'MX', 'États-Unis': 'US', Canada: 'CA', 'Costa Rica': 'CR',
  Panama: 'PA', Jamaïque: 'JM', Haïti: 'HT', Honduras: 'HN', Guatemala: 'GT', Salvador: 'SV', Suriname: 'SR', Curaçao: 'CW', 'Trinité-et-Tobago': 'TT',
  'Rép. dominicaine': 'DO', Martinique: 'MQ', Guadeloupe: 'GP', Maroc: 'MA', Algérie: 'DZ', Tunisie: 'TN', Égypte: 'EG', Libye: 'LY', Sénégal: 'SN',
  Mali: 'ML', "Côte d'Ivoire": 'CI', Ghana: 'GH', Nigeria: 'NG', Cameroun: 'CM', 'RD Congo': 'CD', Congo: 'CG', Gabon: 'GA', Guinée: 'GN',
  'Guinée-Bissau': 'GW', 'Burkina Faso': 'BF', Niger: 'NE', Bénin: 'BJ', Togo: 'TG', 'Cap-Vert': 'CV', Gambie: 'GM', Mauritanie: 'MR',
  'Sierra Leone': 'SL', Liberia: 'LR', Angola: 'AO', Zambie: 'ZM', Zimbabwe: 'ZW', 'Afrique du Sud': 'ZA', Mozambique: 'MZ', Kenya: 'KE',
  Ouganda: 'UG', Tanzanie: 'TZ', Madagascar: 'MG', Comores: 'KM', 'Guinée équatoriale': 'GQ', Centrafrique: 'CF', Soudan: 'SD', Japon: 'JP',
  'Corée du Sud': 'KR', Chine: 'CN', Australie: 'AU', 'Arabie saoudite': 'SA', Qatar: 'QA', 'Émirats arabes unis': 'AE', Iran: 'IR', Irak: 'IQ',
  Jordanie: 'JO', Syrie: 'SY', Liban: 'LB', Palestine: 'PS', Ouzbékistan: 'UZ', Indonésie: 'ID', Thaïlande: 'TH', 'Nouvelle-Zélande': 'NZ',
  Yémen: 'YE', 'Hong Kong': 'HK', Bahreïn: 'BH', Philippines: 'PH', Malaisie: 'MY',
};
const SUB = { Angleterre: 'gbeng', Écosse: 'gbsct', 'Pays de Galles': 'gbwls' };
export function nationFlag(n) {
  if (SUB[n]) return String.fromCodePoint(0x1f3f4, ...[...SUB[n]].map((c) => 0xe0000 + c.charCodeAt(0)), 0xe007f);
  const iso = ISO[n];
  return iso ? String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '🏳️';
}

const CONMEBOL = ['Brésil', 'Argentine', 'Uruguay', 'Colombie', 'Chili', 'Équateur', 'Pérou', 'Paraguay', 'Bolivie', 'Venezuela'];
const CONCACAF = ['Mexique', 'États-Unis', 'Canada', 'Costa Rica', 'Panama', 'Jamaïque', 'Haïti', 'Honduras', 'Guatemala', 'Salvador', 'Suriname', 'Curaçao', 'Trinité-et-Tobago', 'Rép. dominicaine', 'Martinique', 'Guadeloupe'];
const CAF = ['Maroc', 'Algérie', 'Tunisie', 'Égypte', 'Libye', 'Sénégal', 'Mali', "Côte d'Ivoire", 'Ghana', 'Nigeria', 'Cameroun', 'RD Congo', 'Congo', 'Gabon', 'Guinée', 'Guinée-Bissau', 'Burkina Faso', 'Niger', 'Bénin', 'Togo', 'Cap-Vert', 'Gambie', 'Mauritanie', 'Sierra Leone', 'Liberia', 'Angola', 'Zambie', 'Zimbabwe', 'Afrique du Sud', 'Mozambique', 'Kenya', 'Ouganda', 'Tanzanie', 'Madagascar', 'Comores', 'Guinée équatoriale', 'Centrafrique', 'Soudan'];
const AFC = ['Japon', 'Corée du Sud', 'Chine', 'Australie', 'Arabie saoudite', 'Qatar', 'Émirats arabes unis', 'Iran', 'Irak', 'Jordanie', 'Syrie', 'Liban', 'Palestine', 'Ouzbékistan', 'Indonésie', 'Thaïlande', 'Yémen', 'Hong Kong', 'Bahreïn', 'Philippines', 'Malaisie'];
const OFC = ['Nouvelle-Zélande', 'Fidji', 'Nouvelle-Calédonie'];
const CONF = {};
for (const [k, l] of Object.entries({ CONMEBOL, CONCACAF, CAF, AFC, OFC })) for (const n of l) CONF[n] = k;
/** Confédération d'une nation (UEFA par défaut). */
export const confedOf = (n) => CONF[n] || 'UEFA';

/** Pays hôte (code climat du jeu) pour la météo des tournois. */
export const NATION_COUNTRY = { France: 'FRA', Espagne: 'ESP', Allemagne: 'GER', Italie: 'ITA', Angleterre: 'ENG', Portugal: 'POR', Brésil: 'BRA', Argentine: 'ARG', 'États-Unis': 'USA', Mexique: 'MEX', Maroc: 'MAR', Égypte: 'EGY', Qatar: 'QAT', 'Arabie saoudite': 'KSA', Japon: 'JPN', 'Corée du Sud': 'KOR', Chili: 'CHI', Colombie: 'COL', Turquie: 'TUR', 'Pays-Bas': 'NED', Belgique: 'BEL' };
