// The games offered for one-tap download. Files come straight from the
// IF Archive (which allows browser downloads) the first time, then live on
// the phone. Zips are unpacked on the phone to find the story file.

export const CATALOG = [
  {
    id: 'catalog:counterfeit-monkey',
    title: 'Counterfeit Monkey',
    byline: 'Emily Short, 2012',
    blurb: '#1 on IFDB\'s all-time ranking. A wordplay adventure where you change things by adding and removing letters. Long enough for several driving days.',
    download: 'https://ifarchive.org/if-archive/games/glulx/CounterfeitMonkey.gblorb',
    ifdb: 'https://ifdb.org/search?searchfor=Counterfeit+Monkey',
  },
  {
    id: 'catalog:dr-ludwig',
    title: 'Dr Ludwig and the Devil',
    byline: 'SV Linwood, 2023',
    blurb: 'Winner of IFComp 2023 and co-winner of IFDB\'s Game of the Year.',
    download: 'https://ifarchive.org/if-archive/games/competition2023/Games/Dr%20Ludwig%20and%20the%20Devil.zip',
    ifdb: 'https://ifdb.org/search?searchfor=Dr+Ludwig+and+the+Devil',
  },
  {
    id: 'catalog:the-bat',
    title: 'THE BAT',
    byline: 'Chandler Groover, 2024',
    blurb: 'Winner of IFComp 2024.',
    download: 'https://ifarchive.org/if-archive/games/competition2024/Games/THE_BAT.zip',
    ifdb: 'https://ifdb.org/search?searchfor=THE+BAT+Chandler+Groover',
  },
]
