// Starter posters and attract posters. All events are invented.
export interface StarterPoster { lines: string[]; red: number[]; seed: number }

export const STARTERS: StarterPoster[] = [
  { lines: ['Big Hollow', 'Brass band', 'night', 'Friday', 'at the', 'Bandstand'], red: [1], seed: 1 },
  { lines: ['Grange hall', 'Saturday', 'dance', 'with', 'The Hollow Creek Five', 'Doors at eight'], red: [2], seed: 3 },
  { lines: ['Swap meet', 'Sunday', 'at the', 'Grange lot', 'Tools, quilts, jars', 'Coffee & pie'], red: [1], seed: 2 },
  { lines: ['Tri-county fair', 'Mule pull', 'and', 'Fiddle contest', 'Three days'], red: [3], seed: 4 },
  { lines: ['Barn dance', 'tonight', 'Caller & band', 'All welcome'], red: [1], seed: 5 },
];

export const PAPERS = [
  { id: 'salmon', name: 'Salmon', hex: '#f2b8a2' },
  { id: 'canary', name: 'Canary', hex: '#f3d55b' },
  { id: 'mint', name: 'Mint', hex: '#bfe0c6' },
  { id: 'sky', name: 'Sky', hex: '#bcd9ea' },
  { id: 'newsprint', name: 'Newsprint', hex: '#e9e2d0' },
];

export const INKS = [
  { id: 'black-red', name: 'Black and red', main: '#151210', second: '#c8321e' },
  { id: 'blue-red', name: 'Blue and red', main: '#1f4fa8', second: '#c8321e' },
  { id: 'red-black', name: 'Red and black', main: '#c8321e', second: '#151210' },
];
