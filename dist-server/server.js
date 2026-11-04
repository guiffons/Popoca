// server.ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import fs3 from "fs";
import os2 from "os";
import path3 from "path";
import https from "https";
import dns from "dns";
import stream from "stream";
import { fileURLToPath } from "url";

// server/tmdbService.ts
function normalizeSearchText(text) {
  if (!text) return "";
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function getPosterUrl(imdbId) {
  return `https://images.metahub.space/poster/medium/${imdbId}/img`;
}
function getBackdropUrl(imdbId) {
  return `https://images.metahub.space/background/large/${imdbId}/img`;
}
function makeExactSeason(seriesId, imdbId, seasonNumber, seasonName, exactEpisodeCount, knownEpisodeTitles = [], baseDuration = 24) {
  const episodes = Array.from({ length: exactEpisodeCount }, (_, idx) => {
    const epNum = idx + 1;
    const rawName = knownEpisodeTitles[idx];
    const cleanTitle = rawName ? rawName.startsWith("Ep.") ? rawName : `Ep. ${epNum} - ${rawName}` : `Epis\xF3dio ${epNum}`;
    return {
      id: seriesId * 1e4 + seasonNumber * 100 + epNum,
      episodeNumber: epNum,
      seasonNumber,
      title: cleanTitle,
      overview: `Epis\xF3dio ${epNum} da ${seasonName.split(":")[0] || `Temporada ${seasonNumber}`}.`,
      durationMinutes: baseDuration,
      stillPath: getBackdropUrl(imdbId),
      streamUrl: `/api/stream/${seriesId}?season=${seasonNumber}&episode=${epNum}`
    };
  });
  return {
    seasonNumber,
    name: seasonName,
    episodeCount: exactEpisodeCount,
    episodes
  };
}
var RAW_CATALOG = [
  // --- FILMES DO MOMENTO EM 2026 & GRANDES ESTREIAS (100% VERIFICADOS COM SEEDS ATIVAS E CAPAS HD) ---
  {
    id: 969681,
    imdb_id: "tt22084616",
    title: "Homem-Aranha: Um Novo Dia",
    original_title: "Spider-Man: Brand New Day",
    overview: "Peter Parker tenta focar na faculdade e deixar o manto do Homem-Aranha para tr\xE1s, mas quando uma amea\xE7a in\xE9dita coloca Nova York em risco, ele precisa quebrar sua promessa e encarar as sombras de seu passado.",
    poster_path: getPosterUrl("tt22084616"),
    backdrop_path: getBackdropUrl("tt22084616"),
    release_date: "2026-07-31",
    vote_average: 7.9,
    vote_count: 9800,
    genre_ids: [28, 12, 878],
    media_type: "movie",
    runtime: 145,
    genres: [{ id: 28, name: "A\xE7\xE3o" }, { id: 878, name: "Fic\xE7\xE3o Cient\xEDfica" }],
    stream_url: ""
  },
  {
    id: 687163,
    imdb_id: "tt12042730",
    title: "Devoradores de Estrelas",
    original_title: "Project Hail Mary",
    overview: "Ryland Grace acorda em uma nave espacial a anos-luz de casa sem lembrar quem \xE9 ou como chegou l\xE1. Conforme sua mem\xF3ria retorna, ele descobre ser a \xFAltima esperan\xE7a para salvar a Terra da extin\xE7\xE3o.",
    poster_path: getPosterUrl("tt12042730"),
    backdrop_path: getBackdropUrl("tt12042730"),
    release_date: "2026-03-20",
    vote_average: 8.2,
    vote_count: 8900,
    genre_ids: [878, 12, 18],
    media_type: "movie",
    runtime: 156,
    genres: [{ id: 878, name: "Fic\xE7\xE3o Cient\xEDfica" }, { id: 12, name: "Aventura" }],
    stream_url: ""
  },
  {
    id: 1368337,
    imdb_id: "tt33764258",
    title: "A Odisseia",
    original_title: "The Odyssey",
    overview: "Ap\xF3s o fim da Guerra de Troia, o rei Odisseu enfrenta uma jornada \xE9pica de dez anos pelos mares turbulentos para retornar a \xCDtaca, desafiando deuses, sereias e o Ciclope Polifemo.",
    poster_path: getPosterUrl("tt33764258"),
    backdrop_path: getBackdropUrl("tt33764258"),
    release_date: "2026-07-17",
    vote_average: 8.4,
    vote_count: 11200,
    genre_ids: [12, 28, 18],
    media_type: "movie",
    runtime: 172,
    genres: [{ id: 12, name: "Aventura" }, { id: 18, name: "\xC9pico" }],
    stream_url: ""
  },
  {
    id: 1226863,
    imdb_id: "tt28650488",
    title: "Super Mario Galaxy: O Filme",
    original_title: "The Super Mario Galaxy Movie",
    overview: "Depois de salvar o Reino do Cogumelo, Mario, Luigi, Peach e Toad viajam pelo cosmos para impedir os planos intergal\xE1cticos de Bowser Jr. e Wario.",
    poster_path: getPosterUrl("tt28650488"),
    backdrop_path: getBackdropUrl("tt28650488"),
    release_date: "2026-04-03",
    vote_average: 7.5,
    vote_count: 7400,
    genre_ids: [16, 12, 35],
    media_type: "movie",
    runtime: 98,
    genres: [{ id: 16, name: "Anima\xE7\xE3o" }, { id: 12, name: "Aventura" }],
    stream_url: ""
  },
  {
    id: 1084244,
    imdb_id: "tt29355505",
    title: "Toy Story 5",
    original_title: "Toy Story 5",
    overview: "Woody, Buzz, Jessie e toda a turma enfrentam o maior desafio de suas vidas quando a aten\xE7\xE3o das crian\xE7as passa a ser disputada pelo mundo dos dispositivos eletr\xF4nicos.",
    poster_path: getPosterUrl("tt29355505"),
    backdrop_path: getBackdropUrl("tt29355505"),
    release_date: "2026-06-19",
    vote_average: 7.6,
    vote_count: 6800,
    genre_ids: [16, 35, 12],
    media_type: "movie",
    runtime: 102,
    genres: [{ id: 16, name: "Anima\xE7\xE3o" }, { id: 35, name: "Com\xE9dia" }],
    stream_url: ""
  },
  {
    id: 1314896,
    imdb_id: "tt33612209",
    title: "O Diabo Veste Prada 2",
    original_title: "The Devil Wears Prada 2",
    overview: "Miranda Priestly enfrenta o decl\xEDnio das revistas impressas tradicionais e precisa negociar diretamente com sua ex-assistente Emily, agora uma poderosa executiva do mercado de luxo.",
    poster_path: getPosterUrl("tt33612209"),
    backdrop_path: getBackdropUrl("tt33612209"),
    release_date: "2026-05-01",
    vote_average: 7.4,
    vote_count: 6200,
    genre_ids: [35, 18],
    media_type: "movie",
    runtime: 119,
    genres: [{ id: 35, name: "Com\xE9dia" }, { id: 18, name: "Drama" }],
    stream_url: ""
  },
  {
    id: 936075,
    imdb_id: "tt11378946",
    title: "Michael",
    original_title: "Michael",
    overview: "O retrato cinematogr\xE1fico da vida e do legado de Michael Jackson, acompanhando desde seu prod\xEDgio \xE0 frente do Jackson 5 at\xE9 sua consagra\xE7\xE3o mundial como o Rei do Pop.",
    poster_path: getPosterUrl("tt11378946"),
    backdrop_path: getBackdropUrl("tt11378946"),
    release_date: "2026-04-24",
    vote_average: 7.6,
    vote_count: 5900,
    genre_ids: [18, 36],
    media_type: "movie",
    runtime: 127,
    genres: [{ id: 18, name: "Drama" }, { id: 36, name: "Biografia" }],
    stream_url: ""
  },
  {
    id: 872906,
    imdb_id: "tt15574124",
    title: "Peaky Blinders: O Homem Imortal",
    original_title: "Peaky Blinders: The Immortal Man",
    overview: "Em plena Segunda Guerra Mundial, Tommy Shelby retorna a uma Birmingham devastada por bombardeios para liderar opera\xE7\xF5es secretas e acertar contas definitivas com seu destino.",
    poster_path: getPosterUrl("tt15574124"),
    backdrop_path: getBackdropUrl("tt15574124"),
    release_date: "2026-03-20",
    vote_average: 7.8,
    vote_count: 5400,
    genre_ids: [80, 18, 53],
    media_type: "movie",
    runtime: 112,
    genres: [{ id: 80, name: "Crime" }, { id: 18, name: "Drama" }],
    stream_url: ""
  },
  {
    id: 83533,
    imdb_id: "tt1757678",
    title: "Avatar: Fogo e Cinzas",
    original_title: "Avatar: Fire and Ash",
    overview: "Ap\xF3s uma perda devastadora, a fam\xEDlia de Jake Sully e Neytiri encontra uma nova e agressiva tribo Na'vi conhecida como o Povo das Cinzas, ampliando o conflito por Pandora.",
    poster_path: getPosterUrl("tt1757678"),
    backdrop_path: getBackdropUrl("tt1757678"),
    release_date: "2025-12-19",
    vote_average: 7.7,
    vote_count: 8700,
    genre_ids: [878, 12, 28],
    media_type: "movie",
    runtime: 197,
    genres: [{ id: 878, name: "Fic\xE7\xE3o Cient\xEDfica" }, { id: 12, name: "Aventura" }],
    stream_url: ""
  },
  {
    id: 1084242,
    imdb_id: "tt26443597",
    title: "Zootopia 2",
    original_title: "Zootopia 2",
    overview: "Os detetives Judy Hopps e Nick Wilde seguem a pista sinuosa de um misterioso r\xE9ptil que chega a Zootopia e vira a metr\xF3pole mam\xEDfera de cabe\xE7a para baixo.",
    poster_path: getPosterUrl("tt26443597"),
    backdrop_path: getBackdropUrl("tt26443597"),
    release_date: "2025-11-26",
    vote_average: 7.8,
    vote_count: 7900,
    genre_ids: [16, 35, 12],
    media_type: "movie",
    runtime: 108,
    genres: [{ id: 16, name: "Anima\xE7\xE3o" }, { id: 35, name: "Com\xE9dia" }],
    stream_url: ""
  },
  {
    id: 911430,
    imdb_id: "tt16311594",
    title: "F1: O Filme",
    original_title: "F1",
    overview: "Sonny Hayes, um lend\xE1rio piloto dos anos 90, sai da aposentadoria para guiar um jovem prod\xEDgio na equipe APXGP contra os tit\xE3s mundiais da F\xF3rmula 1.",
    poster_path: getPosterUrl("tt16311594"),
    backdrop_path: getBackdropUrl("tt16311594"),
    release_date: "2025-06-27",
    vote_average: 7.8,
    vote_count: 8400,
    genre_ids: [28, 18],
    media_type: "movie",
    runtime: 155,
    genres: [{ id: 28, name: "A\xE7\xE3o" }, { id: 18, name: "Esporte & Drama" }],
    stream_url: ""
  },
  {
    id: 1061474,
    imdb_id: "tt5950044",
    title: "Superman",
    original_title: "Superman",
    overview: "Clark Kent busca reconciliar sua heran\xE7a kryptoniana com sua cria\xE7\xE3o humana em Smallville, guiado pela bondade em um mundo que enxerga o hero\xEDsmo como antiquado.",
    poster_path: getPosterUrl("tt5950044"),
    backdrop_path: getBackdropUrl("tt5950044"),
    release_date: "2025-07-11",
    vote_average: 7.5,
    vote_count: 8600,
    genre_ids: [28, 12, 878],
    media_type: "movie",
    runtime: 129,
    genres: [{ id: 28, name: "A\xE7\xE3o" }, { id: 878, name: "Fic\xE7\xE3o Cient\xEDfica" }],
    stream_url: ""
  },
  {
    id: 1054867,
    imdb_id: "tt30144839",
    title: "Uma Batalha Ap\xF3s a Outra",
    original_title: "One Battle After Another",
    overview: "Quando um antigo inimigo implac\xE1vel ressurge ap\xF3s dezesseis anos, um grupo de ex-revolucion\xE1rios se re\xFAne em uma corrida desesperada para resgatar a filha de um dos seus.",
    poster_path: getPosterUrl("tt30144839"),
    backdrop_path: getBackdropUrl("tt30144839"),
    release_date: "2025-09-26",
    vote_average: 7.7,
    vote_count: 6500,
    genre_ids: [28, 80, 53],
    media_type: "movie",
    runtime: 161,
    genres: [{ id: 53, name: "Suspense" }, { id: 80, name: "Crime" }],
    stream_url: ""
  },
  {
    id: 1317288,
    imdb_id: "tt27543632",
    title: "A Empregada",
    original_title: "The Housemaid",
    overview: "Em busca de um recome\xE7o, Millie aceita trabalhar como governanta na luxuosa mans\xE3o da fam\xEDlia Winchester, mas logo descobre que os segredos atr\xE1s das portas trancadas s\xE3o letais.",
    poster_path: getPosterUrl("tt27543632"),
    backdrop_path: getBackdropUrl("tt27543632"),
    release_date: "2025-12-19",
    vote_average: 7.3,
    vote_count: 5200,
    genre_ids: [53, 9648, 18],
    media_type: "movie",
    runtime: 131,
    genres: [{ id: 53, name: "Suspense" }, { id: 9648, name: "Mist\xE9rio" }],
    stream_url: ""
  },
  {
    id: 1097311,
    imdb_id: "tt32141377",
    title: "Exterm\xEDnio: O Templo dos Ossos",
    original_title: "28 Years Later: The Bone Temple",
    overview: "Em uma Gr\xE3-Bretanha isolada quase tr\xEAs d\xE9cadas ap\xF3s o v\xEDrus da raiva, o Dr. Kelson enfrenta uma seita brutal cujas descobertas podem alterar o destino dos sobreviventes.",
    poster_path: getPosterUrl("tt32141377"),
    backdrop_path: getBackdropUrl("tt32141377"),
    release_date: "2026-01-16",
    vote_average: 7.4,
    vote_count: 4900,
    genre_ids: [27, 878, 53],
    media_type: "movie",
    runtime: 109,
    genres: [{ id: 27, name: "Terror" }, { id: 53, name: "Suspense" }],
    stream_url: ""
  },
  {
    id: 931285,
    imdb_id: "tt17490712",
    title: "Mortal Kombat II",
    original_title: "Mortal Kombat II",
    overview: "Os campe\xF5es do Plano Terreno, agora refor\xE7ados pelo astro Johnny Cage, entram no torneio definitivo de vida ou morte contra o tirano Shao Kahn.",
    poster_path: getPosterUrl("tt17490712"),
    backdrop_path: getBackdropUrl("tt17490712"),
    release_date: "2026-05-15",
    vote_average: 7.1,
    vote_count: 5100,
    genre_ids: [28, 14, 12],
    media_type: "movie",
    runtime: 116,
    genres: [{ id: 28, name: "A\xE7\xE3o" }, { id: 14, name: "Fantasia" }],
    stream_url: ""
  },
  {
    id: 1159559,
    imdb_id: "tt27047903",
    title: "P\xE2nico 7",
    original_title: "Scream 7",
    overview: "Quando um novo Ghostface surge na cidade tranquila onde Sidney Prescott construiu uma nova vida, seus piores pesadelos voltam \xE0 tona para amea\xE7ar sua fam\xEDlia.",
    poster_path: getPosterUrl("tt27047903"),
    backdrop_path: getBackdropUrl("tt27047903"),
    release_date: "2026-02-27",
    vote_average: 7,
    vote_count: 4800,
    genre_ids: [27, 9648, 53],
    media_type: "movie",
    runtime: 114,
    genres: [{ id: 27, name: "Terror" }, { id: 9648, name: "Mist\xE9rio" }],
    stream_url: ""
  },
  {
    id: 1306368,
    imdb_id: "tt32642706",
    title: "Dinheiro Suspeito",
    original_title: "The Rip",
    overview: "Policiais de Miami descobrem milh\xF5es de d\xF3lares escondidos em um dep\xF3sito abandonado, desencadeando paranoia e trai\xE7\xE3o quando for\xE7as externas descobrem o valor da apreens\xE3o.",
    poster_path: getPosterUrl("tt32642706"),
    backdrop_path: getBackdropUrl("tt32642706"),
    release_date: "2026-01-16",
    vote_average: 7.2,
    vote_count: 4600,
    genre_ids: [28, 80, 53],
    media_type: "movie",
    runtime: 113,
    genres: [{ id: 80, name: "Crime" }, { id: 53, name: "Suspense" }],
    stream_url: ""
  },
  {
    id: 1078605,
    imdb_id: "tt26581740",
    title: "A Hora do Mal",
    original_title: "Weapons",
    overview: "Em uma pacata comunidade americana, todas as crian\xE7as de uma mesma sala de aula desaparecem misteriosamente no exato mesmo minuto durante a madrugada.",
    poster_path: getPosterUrl("tt26581740"),
    backdrop_path: getBackdropUrl("tt26581740"),
    release_date: "2025-08-08",
    vote_average: 7.5,
    vote_count: 6100,
    genre_ids: [27, 9648, 53],
    media_type: "movie",
    runtime: 128,
    genres: [{ id: 27, name: "Terror" }, { id: 9648, name: "Mist\xE9rio" }],
    stream_url: ""
  },
  {
    id: 1062722,
    imdb_id: "tt1312221",
    title: "Frankenstein",
    original_title: "Frankenstein",
    overview: "Na vis\xE3o g\xF3tica de Guillermo del Toro, o brilhante mas arrogante cientista Victor Frankenstein desafia a natureza ao dar vida a uma criatura senciente em um experimento tr\xE1gico.",
    poster_path: getPosterUrl("tt1312221"),
    backdrop_path: getBackdropUrl("tt1312221"),
    release_date: "2025-11-07",
    vote_average: 7.5,
    vote_count: 5300,
    genre_ids: [27, 18, 878],
    media_type: "movie",
    runtime: 149,
    genres: [{ id: 18, name: "Drama" }, { id: 27, name: "Terror G\xF3tico" }],
    stream_url: ""
  },
  {
    id: 1087192,
    imdb_id: "tt26743210",
    title: "Como Treinar o Seu Drag\xE3o",
    original_title: "How to Train Your Dragon",
    overview: "Na escarpada ilha de Berk, o jovem viking Solu\xE7o desafia s\xE9culos de tradi\xE7\xE3o ao fazer amizade com Banguela, um temido drag\xE3o F\xFAria da Noite.",
    poster_path: getPosterUrl("tt26743210"),
    backdrop_path: getBackdropUrl("tt26743210"),
    release_date: "2025-06-13",
    vote_average: 7.7,
    vote_count: 5800,
    genre_ids: [12, 14, 28],
    media_type: "movie",
    runtime: 125,
    genres: [{ id: 12, name: "Aventura" }, { id: 14, name: "Fantasia" }],
    stream_url: ""
  },
  {
    id: 575265,
    imdb_id: "tt9603208",
    title: "Miss\xE3o: Imposs\xEDvel - O Acerto Final",
    original_title: "Mission: Impossible - The Final Reckoning",
    overview: "Ethan Hunt e sua equipe da IMF embarcam em uma corrida global decisiva para localizar e neutralizar a intelig\xEAncia artificial conhecida como A Entidade antes que controle os arsenais mundiais.",
    poster_path: getPosterUrl("tt9603208"),
    backdrop_path: getBackdropUrl("tt9603208"),
    release_date: "2025-05-23",
    vote_average: 7.4,
    vote_count: 6700,
    genre_ids: [28, 12, 53],
    media_type: "movie",
    runtime: 169,
    genres: [{ id: 28, name: "A\xE7\xE3o" }, { id: 53, name: "Suspense" }],
    stream_url: ""
  },
  {
    id: 1038392,
    imdb_id: "tt22898462",
    title: "Invoca\xE7\xE3o do Mal 4: O \xDAltimo Ritual",
    original_title: "The Conjuring: Last Rites",
    overview: "Ed e Lorraine Warren assumem o caso mais obscuro e pessoal de suas carreiras ao enfrentar uma entidade demon\xEDaca que coloca sua pr\xF3pria fam\xEDlia em risco.",
    poster_path: getPosterUrl("tt22898462"),
    backdrop_path: getBackdropUrl("tt22898462"),
    release_date: "2025-09-05",
    vote_average: 7,
    vote_count: 4500,
    genre_ids: [27, 9648, 53],
    media_type: "movie",
    runtime: 135,
    genres: [{ id: 27, name: "Terror" }, { id: 53, name: "Suspense" }],
    stream_url: ""
  },
  // --- PREMIADOS & CONSAGRADOS RECENTES ---
  {
    id: 1000837,
    imdb_id: "tt14961016",
    title: "Ainda Estou Aqui",
    original_title: "Ainda Estou Aqui",
    overview: "No Rio de Janeiro do in\xEDcio dos anos 1970, Eunice Paiva \xE9 for\xE7ada a se reinventar como ativista e m\xE3e resiliente ap\xF3s o desaparecimento de seu marido, Rubens Paiva.",
    poster_path: getPosterUrl("tt14961016"),
    backdrop_path: getBackdropUrl("tt14961016"),
    release_date: "2024-11-07",
    vote_average: 8.9,
    vote_count: 5200,
    genre_ids: [18, 36],
    media_type: "movie",
    runtime: 137,
    genres: [{ id: 18, name: "Drama Nacional" }, { id: 36, name: "Biografia" }],
    stream_url: ""
  },
  {
    id: 693134,
    imdb_id: "tt15239678",
    title: "Duna: Parte 2",
    original_title: "Dune: Part Two",
    overview: "Paul Atreides se une a Chani e aos Fremen enquanto busca vingan\xE7a contra os conspiradores que destru\xEDram sua fam\xEDlia, lutando para evitar um futuro terr\xEDvel que s\xF3 ele pode prever.",
    poster_path: getPosterUrl("tt15239678"),
    backdrop_path: getBackdropUrl("tt15239678"),
    release_date: "2024-02-27",
    vote_average: 8.5,
    vote_count: 7820,
    genre_ids: [878, 12],
    media_type: "movie",
    runtime: 166,
    genres: [{ id: 878, name: "Fic\xE7\xE3o Cient\xEDfica" }, { id: 12, name: "Aventura" }],
    stream_url: ""
  },
  {
    id: 533535,
    imdb_id: "tt6263850",
    title: "Deadpool & Wolverine",
    original_title: "Deadpool & Wolverine",
    overview: "Wade Wilson tenta levar uma vida pacata, mas quando seu universo enfrenta uma amea\xE7a existencial, ele precisa vestir o uniforme novamente ao lado de um relutante Wolverine.",
    poster_path: getPosterUrl("tt6263850"),
    backdrop_path: getBackdropUrl("tt6263850"),
    release_date: "2024-07-24",
    vote_average: 7.8,
    vote_count: 6400,
    genre_ids: [28, 35, 878],
    media_type: "movie",
    runtime: 128,
    genres: [{ id: 28, name: "A\xE7\xE3o" }, { id: 35, name: "Com\xE9dia" }],
    stream_url: ""
  },
  {
    id: 1022789,
    imdb_id: "tt22022452",
    title: "Divertida Mente 2",
    original_title: "Inside Out 2",
    overview: "Com a chegada da adolesc\xEAncia de Riley, o quartel-general de sua mente passa por uma reforma repentina para dar lugar a novas emo\xE7\xF5es como Ansiedade, Inveja, T\xE9dio e Vergonha.",
    poster_path: getPosterUrl("tt22022452"),
    backdrop_path: getBackdropUrl("tt22022452"),
    release_date: "2024-06-14",
    vote_average: 7.7,
    vote_count: 5100,
    genre_ids: [16, 35, 12],
    media_type: "movie",
    runtime: 96,
    genres: [{ id: 16, name: "Anima\xE7\xE3o" }, { id: 35, name: "Com\xE9dia" }],
    stream_url: ""
  },
  {
    id: 558449,
    imdb_id: "tt9218128",
    title: "Gladiador II",
    original_title: "Gladiator II",
    overview: "Anos ap\xF3s testemunhar a morte do her\xF3i Maximus, Lucius \xE9 for\xE7ado a entrar no Coliseu depois que sua terra natal \xE9 conquistada pelos imperadores tiranos que agora lideram Roma.",
    poster_path: getPosterUrl("tt9218128"),
    backdrop_path: getBackdropUrl("tt9218128"),
    release_date: "2024-11-14",
    vote_average: 8.1,
    vote_count: 4800,
    genre_ids: [28, 12, 18],
    media_type: "movie",
    runtime: 148,
    genres: [{ id: 28, name: "A\xE7\xE3o" }, { id: 18, name: "Drama Hist\xF3rico" }],
    stream_url: ""
  },
  {
    id: 1184918,
    imdb_id: "tt29623480",
    title: "Rob\xF4 Selvagem",
    original_title: "The Wild Robot",
    overview: "Ap\xF3s um naufr\xE1gio, a rob\xF4 inteligente Roz fica presa em uma ilha deserta e precisa se adaptar ao ambiente hostil construindo la\xE7os com a fauna local e adotando um filhote de ganso \xF3rf\xE3o.",
    poster_path: getPosterUrl("tt29623480"),
    backdrop_path: getBackdropUrl("tt29623480"),
    release_date: "2024-09-12",
    vote_average: 8.4,
    vote_count: 3900,
    genre_ids: [16, 878, 10751],
    media_type: "movie",
    runtime: 102,
    genres: [{ id: 16, name: "Anima\xE7\xE3o" }, { id: 878, name: "Fic\xE7\xE3o Cient\xEDfica" }],
    stream_url: ""
  },
  {
    id: 933260,
    imdb_id: "tt17526714",
    title: "A Subst\xE2ncia",
    original_title: "The Substance",
    overview: "Uma celebridade em decl\xEDnio decide usar uma subst\xE2ncia clandestina que replica suas c\xE9lulas, gerando temporariamente uma vers\xE3o mais jovem e perfeita de si mesma.",
    poster_path: getPosterUrl("tt17526714"),
    backdrop_path: getBackdropUrl("tt17526714"),
    release_date: "2024-09-19",
    vote_average: 7.9,
    vote_count: 3600,
    genre_ids: [27, 878, 18],
    media_type: "movie",
    runtime: 141,
    genres: [{ id: 27, name: "Terror" }, { id: 878, name: "Fic\xE7\xE3o Cient\xEDfica" }],
    stream_url: ""
  },
  {
    id: 939243,
    imdb_id: "tt18259086",
    title: "Sonic 3: O Filme",
    original_title: "Sonic the Hedgehog 3",
    overview: "Sonic, Knuckles e Tails se re\xFAnem contra um novo e poderoso advers\xE1rio, Shadow, um vil\xE3o misterioso com poderes nunca antes vistos.",
    poster_path: getPosterUrl("tt18259086"),
    backdrop_path: getBackdropUrl("tt18259086"),
    release_date: "2024-12-25",
    vote_average: 8,
    vote_count: 3100,
    genre_ids: [28, 12, 35],
    media_type: "movie",
    runtime: 110,
    genres: [{ id: 28, name: "A\xE7\xE3o" }, { id: 12, name: "Aventura" }],
    stream_url: ""
  },
  {
    id: 402431,
    imdb_id: "tt1262426",
    title: "Wicked",
    original_title: "Wicked",
    overview: "A hist\xF3ria n\xE3o contada das bruxas de Oz acompanha Elphaba e Glinda, cuja improv\xE1vel amizade transforma para sempre a Terra de Oz.",
    poster_path: getPosterUrl("tt1262426"),
    backdrop_path: getBackdropUrl("tt1262426"),
    release_date: "2024-11-21",
    vote_average: 7.9,
    vote_count: 2800,
    genre_ids: [14, 10402, 18],
    media_type: "movie",
    runtime: 160,
    genres: [{ id: 14, name: "Fantasia" }, { id: 10402, name: "Musical" }],
    stream_url: ""
  },
  {
    id: 426063,
    imdb_id: "tt5040012",
    title: "Nosferatu",
    original_title: "Nosferatu",
    overview: "Um conto g\xF3tico de obsess\xE3o entre uma jovem assombrada na Alemanha do s\xE9culo XIX e o antigo vampiro da Transilv\xE2nia que a persegue.",
    poster_path: getPosterUrl("tt5040012"),
    backdrop_path: getBackdropUrl("tt5040012"),
    release_date: "2024-12-25",
    vote_average: 7.8,
    vote_count: 2400,
    genre_ids: [27, 9648],
    media_type: "movie",
    runtime: 132,
    genres: [{ id: 27, name: "Terror" }, { id: 9648, name: "Mist\xE9rio" }],
    stream_url: ""
  },
  {
    id: 945961,
    imdb_id: "tt18412256",
    title: "Alien: Romulus",
    original_title: "Alien: Romulus",
    overview: "Enquanto vasculham as profundezas de uma esta\xE7\xE3o espacial abandonada, jovens colonizadores ficam cara a cara com a forma de vida mais letal do universo.",
    poster_path: getPosterUrl("tt18412256"),
    backdrop_path: getBackdropUrl("tt18412256"),
    release_date: "2024-08-15",
    vote_average: 7.6,
    vote_count: 4200,
    genre_ids: [27, 878],
    media_type: "movie",
    runtime: 119,
    genres: [{ id: 27, name: "Terror" }, { id: 878, name: "Fic\xE7\xE3o Cient\xEDfica" }],
    stream_url: ""
  },
  {
    id: 40096,
    imdb_id: "tt0271383",
    title: "O Auto da Compadecida",
    original_title: "O Auto da Compadecida",
    overview: "As aventuras dos nordestinos Jo\xE3o Grilo, um sertanejo pobre e astuto, e Chic\xF3, o mais covarde dos homens, lutando pelo p\xE3o de cada dia no sert\xE3o da Para\xEDba.",
    poster_path: getPosterUrl("tt0271383"),
    backdrop_path: getBackdropUrl("tt0271383"),
    release_date: "2000-09-10",
    vote_average: 8.6,
    vote_count: 4500,
    genre_ids: [35, 12, 18],
    media_type: "movie",
    runtime: 104,
    genres: [{ id: 35, name: "Com\xE9dia Nacional" }, { id: 12, name: "Aventura" }],
    stream_url: ""
  },
  {
    id: 598,
    imdb_id: "tt0317248",
    title: "Cidade de Deus",
    original_title: "Cidade de Deus",
    overview: "Buscap\xE9 \xE9 um jovem morador da Cidade de Deus que cresce em meio \xE0 viol\xEAncia mas descobre na fotografia o caminho para transformar seu destino, enquanto Z\xE9 Pequeno assume o comando do tr\xE1fico.",
    poster_path: getPosterUrl("tt0317248"),
    backdrop_path: getBackdropUrl("tt0317248"),
    release_date: "2002-08-30",
    vote_average: 8.6,
    vote_count: 8200,
    genre_ids: [18, 80],
    media_type: "movie",
    runtime: 130,
    genres: [{ id: 80, name: "Crime" }, { id: 18, name: "Drama Nacional" }],
    stream_url: ""
  },
  {
    id: 7347,
    imdb_id: "tt0861739",
    title: "Tropa de Elite",
    original_title: "Tropa de Elite",
    overview: "Em 1997, o Capit\xE3o Nascimento busca um substituto para seu posto no BOPE enquanto comanda opera\xE7\xF5es intensas nos morros do Rio de Janeiro antes da visita do Papa.",
    poster_path: getPosterUrl("tt0861739"),
    backdrop_path: getBackdropUrl("tt0861739"),
    release_date: "2007-10-05",
    vote_average: 8,
    vote_count: 3900,
    genre_ids: [28, 80, 18],
    media_type: "movie",
    runtime: 115,
    genres: [{ id: 28, name: "A\xE7\xE3o" }, { id: 80, name: "Policial" }],
    stream_url: ""
  },
  {
    id: 238,
    imdb_id: "tt0068646",
    title: "O Poderoso Chef\xE3o",
    original_title: "The Godfather",
    overview: "O patriarca idoso da fam\xEDlia Corleone transfere o controle de seu imp\xE9rio clandestino para seu filho relutante, Michael Corleone, na Nova York do p\xF3s-guerra.",
    poster_path: getPosterUrl("tt0068646"),
    backdrop_path: getBackdropUrl("tt0068646"),
    release_date: "1972-03-24",
    vote_average: 9.2,
    vote_count: 20500,
    genre_ids: [18, 80],
    media_type: "movie",
    runtime: 175,
    genres: [{ id: 80, name: "Crime" }, { id: 18, name: "Drama" }],
    stream_url: ""
  },
  {
    id: 278,
    imdb_id: "tt0111161",
    title: "Um Sonho de Liberdade",
    original_title: "The Shawshank Redemption",
    overview: "Condenado injustamente \xE0 pris\xE3o perp\xE9tua em Shawshank, o banqueiro Andy Dufresne constr\xF3i uma amizade transformadora com Red ao longo de duas d\xE9cadas.",
    poster_path: getPosterUrl("tt0111161"),
    backdrop_path: getBackdropUrl("tt0111161"),
    release_date: "1994-09-23",
    vote_average: 9.3,
    vote_count: 27400,
    genre_ids: [18, 80],
    media_type: "movie",
    runtime: 142,
    genres: [{ id: 18, name: "Drama" }],
    stream_url: ""
  },
  {
    id: 12153,
    imdb_id: "tt0381707",
    title: "As Branquelas",
    original_title: "White Chicks",
    overview: "Dois agentes atrapalhados do FBI se disfar\xE7am como duas socialites milion\xE1rias nos Hamptons para impedir um plano de sequestro.",
    poster_path: getPosterUrl("tt0381707"),
    backdrop_path: getBackdropUrl("tt0381707"),
    release_date: "2004-06-23",
    vote_average: 7,
    vote_count: 4200,
    genre_ids: [35, 80],
    media_type: "movie",
    runtime: 109,
    genres: [{ id: 35, name: "Com\xE9dia" }],
    stream_url: ""
  },
  {
    id: 38365,
    imdb_id: "tt1375670",
    title: "Gente Grande",
    original_title: "Grown Ups",
    overview: "Cinco amigos de inf\xE2ncia se re\xFAnem ap\xF3s trinta anos com suas respectivas fam\xEDlias para passar o feriado de 4 de julho em uma casa no lago.",
    poster_path: getPosterUrl("tt1375670"),
    backdrop_path: getBackdropUrl("tt1375670"),
    release_date: "2010-06-24",
    vote_average: 6.4,
    vote_count: 4100,
    genre_ids: [35],
    media_type: "movie",
    runtime: 102,
    genres: [{ id: 35, name: "Com\xE9dia" }],
    stream_url: ""
  },
  {
    id: 18785,
    imdb_id: "tt1119646",
    title: "Se Beber, N\xE3o Case!",
    original_title: "The Hangover",
    overview: "Ap\xF3s uma despedida de solteiro insana em Las Vegas, tr\xEAs amigos acordam sem mem\xF3ria alguma da noite anterior e precisam encontrar o noivo desaparecido antes do casamento.",
    poster_path: getPosterUrl("tt1119646"),
    backdrop_path: getBackdropUrl("tt1119646"),
    release_date: "2009-06-05",
    vote_average: 7.7,
    vote_count: 16800,
    genre_ids: [35],
    media_type: "movie",
    runtime: 100,
    genres: [{ id: 35, name: "Com\xE9dia" }],
    stream_url: ""
  },
  {
    id: 157336,
    imdb_id: "tt0816692",
    title: "Interestelar",
    original_title: "Interstellar",
    overview: "Com as reservas naturais da Terra esgotadas, um grupo de astronautas atravessa um buraco de minhoca em busca de novos mundos habit\xE1veis para salvar a humanidade.",
    poster_path: getPosterUrl("tt0816692"),
    backdrop_path: getBackdropUrl("tt0816692"),
    release_date: "2014-11-05",
    vote_average: 8.7,
    vote_count: 34500,
    genre_ids: [12, 18, 878],
    media_type: "movie",
    runtime: 169,
    genres: [{ id: 878, name: "Fic\xE7\xE3o Cient\xEDfica" }, { id: 18, name: "Drama" }],
    stream_url: ""
  },
  {
    id: 872585,
    imdb_id: "tt15398776",
    title: "Oppenheimer",
    original_title: "Oppenheimer",
    overview: "A hist\xF3ria \xE9pica do f\xEDsico J. Robert Oppenheimer, seu papel central no Projeto Manhattan e a cria\xE7\xE3o da arma nuclear que alterou o curso da humanidade.",
    poster_path: getPosterUrl("tt15398776"),
    backdrop_path: getBackdropUrl("tt15398776"),
    release_date: "2023-07-19",
    vote_average: 8.3,
    vote_count: 9600,
    genre_ids: [18, 36],
    media_type: "movie",
    runtime: 180,
    genres: [{ id: 18, name: "Drama" }, { id: 36, name: "Hist\xF3ria" }],
    stream_url: ""
  },
  {
    id: 299536,
    imdb_id: "tt4154756",
    title: "Vingadores: Guerra Infinita",
    original_title: "Avengers: Infinity War",
    overview: "Homem de Ferro, Capit\xE3o Am\xE9rica, Thor e os Guardi\xF5es da Gal\xE1xia lutam em uma corrida desesperada contra Thanos antes que as Joias do Infinito exterminem metade do universo.",
    poster_path: getPosterUrl("tt4154756"),
    backdrop_path: getBackdropUrl("tt4154756"),
    release_date: "2018-04-25",
    vote_average: 8.4,
    vote_count: 29e3,
    genre_ids: [12, 28, 878],
    media_type: "movie",
    runtime: 149,
    genres: [{ id: 28, name: "A\xE7\xE3o" }, { id: 12, name: "Aventura" }],
    stream_url: ""
  },
  {
    id: 299534,
    imdb_id: "tt4154796",
    title: "Vingadores: Ultimato",
    original_title: "Avengers: Endgame",
    overview: "Ap\xF3s os eventos devastadores de Guerra Infinita, os Vingadores sobreviventes se re\xFAnem em uma jornada pelo tempo para reverter as a\xE7\xF5es de Thanos.",
    poster_path: getPosterUrl("tt4154796"),
    backdrop_path: getBackdropUrl("tt4154796"),
    release_date: "2019-04-24",
    vote_average: 8.4,
    vote_count: 25100,
    genre_ids: [12, 28, 878],
    media_type: "movie",
    runtime: 181,
    genres: [{ id: 28, name: "A\xE7\xE3o" }, { id: 878, name: "Fic\xE7\xE3o Cient\xEDfica" }],
    stream_url: ""
  },
  {
    id: 634649,
    imdb_id: "tt10872600",
    title: "Homem-Aranha: Sem Volta Para Casa",
    original_title: "Spider-Man: No Way Home",
    overview: "Com a identidade do Homem-Aranha revelada, Peter Parker pede ajuda ao Doutor Estranho, mas um feiti\xE7o mal-sucedido abre o multiverso para vil\xF5es de outras realidades.",
    poster_path: getPosterUrl("tt10872600"),
    backdrop_path: getBackdropUrl("tt10872600"),
    release_date: "2021-12-15",
    vote_average: 8.2,
    vote_count: 20100,
    genre_ids: [28, 12, 878],
    media_type: "movie",
    runtime: 148,
    genres: [{ id: 28, name: "A\xE7\xE3o" }, { id: 12, name: "Aventura" }],
    stream_url: ""
  },
  {
    id: 569094,
    imdb_id: "tt9362722",
    title: "Homem-Aranha: Atrav\xE9s do Aranhaverso",
    original_title: "Spider-Man: Across the Spider-Verse",
    overview: "Miles Morales viaja pelo multiverso, unindo for\xE7as com Gwen Stacy e uma sociedade de protetores aracn\xEDdeos para redefinir o que significa ser her\xF3i.",
    poster_path: getPosterUrl("tt9362722"),
    backdrop_path: getBackdropUrl("tt9362722"),
    release_date: "2023-05-31",
    vote_average: 8.6,
    vote_count: 6800,
    genre_ids: [16, 28, 12, 878],
    media_type: "movie",
    runtime: 140,
    genres: [{ id: 16, name: "Anima\xE7\xE3o" }, { id: 28, name: "A\xE7\xE3o" }],
    stream_url: ""
  },
  {
    id: 155,
    imdb_id: "tt0468569",
    title: "Batman: O Cavaleiro das Trevas",
    original_title: "The Dark Knight",
    overview: "Com a ajuda do tenente Gordon e do promotor Harvey Dent, Batman combate o crime organizado em Gotham at\xE9 o surgimento do an\xE1rquico Coringa.",
    poster_path: getPosterUrl("tt0468569"),
    backdrop_path: getBackdropUrl("tt0468569"),
    release_date: "2008-07-16",
    vote_average: 9,
    vote_count: 31500,
    genre_ids: [18, 28, 80],
    media_type: "movie",
    runtime: 152,
    genres: [{ id: 28, name: "A\xE7\xE3o" }, { id: 80, name: "Crime" }],
    stream_url: ""
  },
  {
    id: 414906,
    imdb_id: "tt1877830",
    title: "Batman",
    original_title: "The Batman",
    overview: "Em seu segundo ano de combate ao crime, Bruce Wayne desvenda a corrup\xE7\xE3o enraizada em Gotham City ao ca\xE7ar o enigm\xE1tico serial killer Charada.",
    poster_path: getPosterUrl("tt1877830"),
    backdrop_path: getBackdropUrl("tt1877830"),
    release_date: "2022-03-01",
    vote_average: 7.8,
    vote_count: 9500,
    genre_ids: [80, 9648, 53],
    media_type: "movie",
    runtime: 176,
    genres: [{ id: 80, name: "Crime" }, { id: 9648, name: "Mist\xE9rio" }],
    stream_url: ""
  },
  {
    id: 475557,
    imdb_id: "tt7286456",
    title: "Coringa",
    original_title: "Joker",
    overview: "Isolado, intimidado e desconsiderado pela sociedade em Gotham, o comediante fracassado Arthur Fleck inicia uma lenta descida \xE0 loucura como o criminoso Coringa.",
    poster_path: getPosterUrl("tt7286456"),
    backdrop_path: getBackdropUrl("tt7286456"),
    release_date: "2019-10-02",
    vote_average: 8.4,
    vote_count: 24900,
    genre_ids: [80, 53, 18],
    media_type: "movie",
    runtime: 122,
    genres: [{ id: 80, name: "Crime" }, { id: 18, name: "Drama" }],
    stream_url: ""
  },
  {
    id: 122,
    imdb_id: "tt0167260",
    title: "O Senhor dos An\xE9is: O Retorno do Rei",
    original_title: "The Lord of the Rings: The Return of the King",
    overview: "Gandalf e Aragorn lideram o Mundo dos Homens contra o ex\xE9rcito de Sauron para distrair seu olhar de Frodo e Sam enquanto se aproximam da Montanha da Perdi\xE7\xE3o.",
    poster_path: getPosterUrl("tt0167260"),
    backdrop_path: getBackdropUrl("tt0167260"),
    release_date: "2003-12-17",
    vote_average: 9,
    vote_count: 23800,
    genre_ids: [12, 14, 28],
    media_type: "movie",
    runtime: 201,
    genres: [{ id: 14, name: "Fantasia" }, { id: 12, name: "Aventura" }],
    stream_url: ""
  },
  {
    id: 671,
    imdb_id: "tt0241527",
    title: "Harry Potter e a Pedra Filosofal",
    original_title: "Harry Potter and the Sorcerer's Stone",
    overview: "Um garoto \xF3rf\xE3o descobre em seu anivers\xE1rio de 11 anos que \xE9 um bruxo e ingressa na Escola de Magia e Bruxaria de Hogwarts.",
    poster_path: getPosterUrl("tt0241527"),
    backdrop_path: getBackdropUrl("tt0241527"),
    release_date: "2001-11-16",
    vote_average: 7.9,
    vote_count: 26700,
    genre_ids: [12, 14],
    media_type: "movie",
    runtime: 152,
    genres: [{ id: 14, name: "Fantasia" }, { id: 12, name: "Aventura" }],
    stream_url: ""
  },
  {
    id: 673,
    imdb_id: "tt0304141",
    title: "Harry Potter e o Prisioneiro de Azkaban",
    original_title: "Harry Potter and the Prisoner of Azkaban",
    overview: "Em seu terceiro ano em Hogwarts, Harry descobre que o perigoso prisioneiro Sirius Black escapou de Azkaban e parece estar atr\xE1s dele.",
    poster_path: getPosterUrl("tt0304141"),
    backdrop_path: getBackdropUrl("tt0304141"),
    release_date: "2004-05-31",
    vote_average: 8,
    vote_count: 21400,
    genre_ids: [12, 14],
    media_type: "movie",
    runtime: 142,
    genres: [{ id: 14, name: "Fantasia" }, { id: 12, name: "Aventura" }],
    stream_url: ""
  },
  {
    id: 27205,
    imdb_id: "tt1375666",
    title: "A Origem",
    original_title: "Inception",
    overview: "Dom Cobb \xE9 um ladr\xE3o especializado em extrair segredos do subconsciente durante o sonho que recebe a miss\xE3o inversa: plantar uma ideia na mente de um herdeiro.",
    poster_path: getPosterUrl("tt1375666"),
    backdrop_path: getBackdropUrl("tt1375666"),
    release_date: "2010-07-15",
    vote_average: 8.8,
    vote_count: 36e3,
    genre_ids: [28, 878, 12],
    media_type: "movie",
    runtime: 148,
    genres: [{ id: 28, name: "A\xE7\xE3o" }, { id: 878, name: "Fic\xE7\xE3o Cient\xEDfica" }],
    stream_url: ""
  },
  {
    id: 550,
    imdb_id: "tt0137523",
    title: "Clube da Luta",
    original_title: "Fight Club",
    overview: "Um trabalhador insone conhece o carism\xE1tico vendedor de sab\xE3o Tyler Durden e juntos criam um clube clandestino de combate que foge ao controle.",
    poster_path: getPosterUrl("tt0137523"),
    backdrop_path: getBackdropUrl("tt0137523"),
    release_date: "1999-10-15",
    vote_average: 8.8,
    vote_count: 28e3,
    genre_ids: [18],
    media_type: "movie",
    runtime: 139,
    genres: [{ id: 18, name: "Drama" }],
    stream_url: ""
  },
  {
    id: 680,
    imdb_id: "tt0110912",
    title: "Pulp Fiction: Tempo de Viol\xEAncia",
    original_title: "Pulp Fiction",
    overview: "As vidas de dois assassinos da m\xE1fia, um boxeador, a esposa de um g\xE2ngster e um casal de assaltantes se entrela\xE7am em quatro hist\xF3rias em Los Angeles.",
    poster_path: getPosterUrl("tt0110912"),
    backdrop_path: getBackdropUrl("tt0110912"),
    release_date: "1994-10-14",
    vote_average: 8.9,
    vote_count: 27100,
    genre_ids: [53, 80],
    media_type: "movie",
    runtime: 154,
    genres: [{ id: 80, name: "Crime" }, { id: 53, name: "Suspense" }],
    stream_url: ""
  },
  {
    id: 13,
    imdb_id: "tt0109830",
    title: "Forrest Gump: O Contador de Hist\xF3rias",
    original_title: "Forrest Gump",
    overview: "Mesmo com racioc\xEDnio simples e cora\xE7\xE3o puro, Forrest Gump participa acidentalmente dos maiores momentos hist\xF3ricos dos Estados Unidos enquanto busca seu amor de inf\xE2ncia.",
    poster_path: getPosterUrl("tt0109830"),
    backdrop_path: getBackdropUrl("tt0109830"),
    release_date: "1994-07-06",
    vote_average: 8.8,
    vote_count: 26800,
    genre_ids: [35, 18],
    media_type: "movie",
    runtime: 142,
    genres: [{ id: 18, name: "Drama" }, { id: 35, name: "Com\xE9dia" }],
    stream_url: ""
  },
  {
    id: 105,
    imdb_id: "tt0088763",
    title: "De Volta para o Futuro",
    original_title: "Back to the Future",
    overview: "Marty McFly \xE9 acidentalmente enviado trinta anos ao passado em um DeLorean modificado pelo cientista Doc Brown e precisa garantir que seus pais se apaixonem.",
    poster_path: getPosterUrl("tt0088763"),
    backdrop_path: getBackdropUrl("tt0088763"),
    release_date: "1985-07-03",
    vote_average: 8.5,
    vote_count: 19600,
    genre_ids: [12, 35, 878],
    media_type: "movie",
    runtime: 116,
    genres: [{ id: 12, name: "Aventura" }, { id: 878, name: "Fic\xE7\xE3o Cient\xEDfica" }],
    stream_url: ""
  },
  {
    id: 603,
    imdb_id: "tt0133093",
    title: "Matrix",
    original_title: "The Matrix",
    overview: "Thomas Anderson descobre que a realidade que conhece \xE9 uma simula\xE7\xE3o computadorizada criada por m\xE1quinas conscientes para dominar a humanidade.",
    poster_path: getPosterUrl("tt0133093"),
    backdrop_path: getBackdropUrl("tt0133093"),
    release_date: "1999-03-30",
    vote_average: 8.7,
    vote_count: 25e3,
    genre_ids: [28, 878],
    media_type: "movie",
    runtime: 136,
    genres: [{ id: 28, name: "A\xE7\xE3o" }, { id: 878, name: "Fic\xE7\xE3o Cient\xEDfica" }],
    stream_url: ""
  },
  {
    id: 98,
    imdb_id: "tt0172495",
    title: "Gladiador",
    original_title: "Gladiator",
    overview: "O general romano Maximus \xE9 tra\xEDdo quando o filho de Marco Aur\xE9lio assassina o imperador e toma o trono, sendo for\xE7ado a lutar na arena por justi\xE7a.",
    poster_path: getPosterUrl("tt0172495"),
    backdrop_path: getBackdropUrl("tt0172495"),
    release_date: "2000-05-01",
    vote_average: 8.5,
    vote_count: 18400,
    genre_ids: [28, 18, 12],
    media_type: "movie",
    runtime: 155,
    genres: [{ id: 28, name: "A\xE7\xE3o" }, { id: 18, name: "Drama" }],
    stream_url: ""
  },
  {
    id: 361743,
    imdb_id: "tt1745960",
    title: "Top Gun: Maverick",
    original_title: "Top Gun: Maverick",
    overview: 'Depois de mais de 30 anos de servi\xE7o como um dos principais aviadores da Marinha, Pete "Maverick" Mitchell treina um destacamento de graduados Top Gun para uma miss\xE3o quase imposs\xEDvel.',
    poster_path: getPosterUrl("tt1745960"),
    backdrop_path: getBackdropUrl("tt1745960"),
    release_date: "2022-05-24",
    vote_average: 8.3,
    vote_count: 9100,
    genre_ids: [28, 18],
    media_type: "movie",
    runtime: 130,
    genres: [{ id: 28, name: "A\xE7\xE3o" }, { id: 18, name: "Drama" }],
    stream_url: ""
  },
  {
    id: 76600,
    imdb_id: "tt1630029",
    title: "Avatar: O Caminho da \xC1gua",
    original_title: "Avatar: The Way of Water",
    overview: "Jake Sully vive com sua nova fam\xEDlia em Pandora, mas quando uma antiga amea\xE7a retorna, ele precisa se aliar ao cl\xE3 aqu\xE1tico Metkayina para proteger seu lar.",
    poster_path: getPosterUrl("tt1630029"),
    backdrop_path: getBackdropUrl("tt1630029"),
    release_date: "2022-12-14",
    vote_average: 7.7,
    vote_count: 11500,
    genre_ids: [878, 12, 28],
    media_type: "movie",
    runtime: 192,
    genres: [{ id: 878, name: "Fic\xE7\xE3o Cient\xEDfica" }, { id: 12, name: "Aventura" }],
    stream_url: ""
  },
  {
    id: 245891,
    imdb_id: "tt2911666",
    title: "John Wick: De Volta ao Jogo",
    original_title: "John Wick",
    overview: "Um ex-assassino de aluguel sai da aposentadoria para rastrear os g\xE2ngsteres que invadiram sua casa e tiraram tudo dele.",
    poster_path: getPosterUrl("tt2911666"),
    backdrop_path: getBackdropUrl("tt2911666"),
    release_date: "2014-10-22",
    vote_average: 7.4,
    vote_count: 18900,
    genre_ids: [28, 53],
    media_type: "movie",
    runtime: 101,
    genres: [{ id: 28, name: "A\xE7\xE3o" }, { id: 53, name: "Suspense" }],
    stream_url: ""
  },
  {
    id: 138843,
    imdb_id: "tt1457767",
    title: "Invoca\xE7\xE3o do Mal",
    original_title: "The Conjuring",
    overview: "Os investigadores paranormais Ed e Lorraine Warren trabalham para ajudar uma fam\xEDlia aterrorizada por uma presen\xE7a sombria em sua fazenda isolada.",
    poster_path: getPosterUrl("tt1457767"),
    backdrop_path: getBackdropUrl("tt1457767"),
    release_date: "2013-07-18",
    vote_average: 7.5,
    vote_count: 11200,
    genre_ids: [27, 53],
    media_type: "movie",
    runtime: 112,
    genres: [{ id: 27, name: "Terror" }, { id: 53, name: "Suspense" }],
    stream_url: ""
  },
  {
    id: 496243,
    imdb_id: "tt6751668",
    title: "Parasita",
    original_title: "\uAE30\uC0DD\uCDA9",
    overview: "Toda a fam\xEDlia de Ki-taek est\xE1 desempregada at\xE9 que o filho mais velho come\xE7a a dar aulas de ingl\xEAs para a rica fam\xEDlia Park, desencadeando uma simbiose imprevis\xEDvel.",
    poster_path: getPosterUrl("tt6751668"),
    backdrop_path: getBackdropUrl("tt6751668"),
    release_date: "2019-05-30",
    vote_average: 8.5,
    vote_count: 18100,
    genre_ids: [35, 53, 18],
    media_type: "movie",
    runtime: 132,
    genres: [{ id: 53, name: "Suspense" }, { id: 18, name: "Drama" }],
    stream_url: ""
  },
  {
    id: 129,
    imdb_id: "tt0245429",
    title: "A Viagem de Chihiro",
    original_title: "\u5343\u3068\u5343\u5C0B\u306E\u795E\u96A0\u3057",
    overview: "Durante a mudan\xE7a de sua fam\xEDlia, a menina Chihiro entra em um mundo governado por deuses, feiticeiras e esp\xEDritos onde humanos s\xE3o transformados em feras.",
    poster_path: getPosterUrl("tt0245429"),
    backdrop_path: getBackdropUrl("tt0245429"),
    release_date: "2001-07-20",
    vote_average: 8.6,
    vote_count: 16200,
    genre_ids: [16, 14, 12],
    media_type: "movie",
    runtime: 125,
    genres: [{ id: 16, name: "Anima\xE7\xE3o" }, { id: 14, name: "Fantasia" }],
    stream_url: ""
  },
  {
    id: 8587,
    imdb_id: "tt0110357",
    title: "O Rei Le\xE3o",
    original_title: "The Lion King",
    overview: "O jovem pr\xEDncipe le\xE3o Simba foge de seu reino ap\xF3s o assassinato de seu pai Mufasa pelo trai\xE7oeiro tio Scar, mas anos depois precisa retornar para assumir seu lugar.",
    poster_path: getPosterUrl("tt0110357"),
    backdrop_path: getBackdropUrl("tt0110357"),
    release_date: "1994-06-24",
    vote_average: 8.5,
    vote_count: 17900,
    genre_ids: [16, 18, 12],
    media_type: "movie",
    runtime: 88,
    genres: [{ id: 16, name: "Anima\xE7\xE3o" }, { id: 12, name: "Aventura" }],
    stream_url: ""
  },
  {
    id: 823464,
    imdb_id: "tt14539740",
    title: "Godzilla e Kong: O Novo Imp\xE9rio",
    original_title: "Godzilla x Kong: The New Empire",
    overview: "O todo-poderoso Kong e o tem\xEDvel Godzilla unem for\xE7as contra uma colossal amea\xE7a mortal escondida nas profundezas da Terra Oca.",
    poster_path: getPosterUrl("tt14539740"),
    backdrop_path: getBackdropUrl("tt14539740"),
    release_date: "2024-03-27",
    vote_average: 7.2,
    vote_count: 3750,
    genre_ids: [28, 878, 12],
    media_type: "movie",
    runtime: 115,
    genres: [{ id: 28, name: "A\xE7\xE3o" }, { id: 878, name: "Fic\xE7\xE3o Cient\xEDfica" }],
    stream_url: ""
  },
  // =========================================================================
  // --- SÉRIES COM CONTAGEM EXATA DE TEMPORADAS E EPISÓDIOS (ZERO DUPLICATAS) ---
  // =========================================================================
  {
    id: 1396,
    imdb_id: "tt0903747",
    title: "Breaking Bad: A Qu\xEDmica do Mal",
    original_title: "Breaking Bad",
    overview: "Um professor de qu\xEDmica do ensino m\xE9dio diagnosticado com c\xE2ncer de pulm\xE3o inoper\xE1vel se junta a um ex-aluno para fabricar metanfetamina e assegurar o futuro financeiro de sua fam\xEDlia.",
    poster_path: getPosterUrl("tt0903747"),
    backdrop_path: getBackdropUrl("tt0903747"),
    release_date: "2008-01-20",
    vote_average: 9.5,
    vote_count: 19800,
    genre_ids: [18, 80],
    media_type: "tv",
    number_of_seasons: 5,
    genres: [{ id: 18, name: "Drama" }, { id: 80, name: "Crime" }],
    stream_url: "",
    seasons: [
      makeExactSeason(1396, "tt0903747", 1, "Temporada 1", 7, [
        "Piloto",
        "O Gato Est\xE1 no Saco...",
        "...E o Saco Est\xE1 no Rio",
        "Homem com C\xE2ncer",
        "Mat\xE9ria Cinzenta",
        "Um Punhado de Nada",
        "Um Acordo Sem Viol\xEAncia"
      ], 48),
      makeExactSeason(1396, "tt0903747", 2, "Temporada 2", 13, [
        "Sete Trinta e Sete",
        "Grelhado",
        "Picado por uma Abelha Morta",
        "No Fundo do Po\xE7o",
        "Quebra",
        "Esconde-Esconde",
        "Negro y Azul",
        "Melhor Ligar pro Saul",
        "4 Dias Fora",
        "Acima",
        "Mandala",
        "F\xEAnix",
        "ABQ"
      ], 47),
      makeExactSeason(1396, "tt0903747", 3, "Temporada 3", 13, [
        "Sem Mais",
        "Caballo Sin Nombre",
        "I.F.T.",
        "Luz Verde",
        "M\xE1s",
        "P\xF4r do Sol",
        "Um Minuto",
        "Eu Vejo Voc\xEA",
        "Kafkiano",
        "A Mosca",
        "Abiquiu",
        "Meias Medidas",
        "Medidas Completas"
      ], 47),
      makeExactSeason(1396, "tt0903747", 4, "Temporada 4", 13, [
        "Estilete",
        "Calibre 38",
        "Casa Aberta",
        "Pontos-Chave",
        "Escopeta",
        "Encurralado",
        "Cachorro Problem\xE1tico",
        "Hermanos",
        "Bug",
        "Sa\xFAde",
        "Crawl Space",
        "Fim dos Tempos",
        "Face Off"
      ], 48),
      makeExactSeason(1396, "tt0903747", 5, "Temporada 5", 16, [
        "Viva Livre ou Morra",
        "Madrigal",
        "Pagamento de Risco",
        "Cinquenta e Um",
        "Carga Morta",
        "Compra",
        "Diga Meu Nome",
        "Planando sobre Tudo",
        "Dinheiro Sangrento",
        "Enterrado",
        "Confiss\xF5es",
        "C\xE3o Raivoso",
        "To'hajiilee",
        "Ozymandias",
        "Estado de Granito",
        "Felina"
      ], 50)
    ]
  },
  {
    id: 66732,
    imdb_id: "tt4574334",
    title: "Stranger Things",
    original_title: "Stranger Things",
    overview: "Quando um garoto desaparece em Hawkins, um grupo de amigos descobre experimentos secretos, for\xE7as sobrenaturais do Mundo Invertido e uma garota com poderes telecin\xE9ticos.",
    poster_path: getPosterUrl("tt4574334"),
    backdrop_path: getBackdropUrl("tt4574334"),
    release_date: "2016-07-15",
    vote_average: 8.6,
    vote_count: 17200,
    genre_ids: [18, 9648, 10765],
    media_type: "tv",
    number_of_seasons: 4,
    genres: [{ id: 10765, name: "Sci-Fi & Fantasia" }, { id: 18, name: "Drama" }],
    stream_url: "",
    seasons: [
      makeExactSeason(66732, "tt4574334", 1, "Temporada 1", 8, [
        "O Desaparecimento de Will Byers",
        "A Estranha da Maple Street",
        "Caramba",
        "O Corpo",
        "A Pulga e o Acr\xF3bata",
        "O Monstro",
        "A Banheira",
        "O Mundo Invertido"
      ], 50),
      makeExactSeason(66732, "tt4574334", 2, "Temporada 2", 9, [
        "MADMAX",
        "Gostosuras ou Travessuras, Aberra\xE7\xE3o",
        "O Girino",
        "Will, o S\xE1bio",
        "Dig Dug",
        "O Espi\xE3o",
        "A Irm\xE3 Perdida",
        "O Devorador de Mentes",
        "O Portal"
      ], 52),
      makeExactSeason(66732, "tt4574334", 3, "Temporada 3", 8, [
        "Est\xE1 Me Ouvindo, Suzie?",
        "O Caso dos Ratos",
        "O Caso da Salva-Vidas Desaparecida",
        "A Prova da Sauna",
        "Os Devorados",
        "E Pluribus Unum",
        "A Mordida",
        "A Batalha de Starcourt"
      ], 55),
      makeExactSeason(66732, "tt4574334", 4, "Temporada 4", 9, [
        "O Clube Hellfire",
        "A Maldi\xE7\xE3o de Vecna",
        "O Monstro e a Super-Hero\xEDna",
        "Querido Billy",
        "O Projeto Nina",
        "Mergulho",
        "O Massacre no Laborat\xF3rio de Hawkins",
        "Papai",
        "O Plano"
      ], 75)
    ]
  },
  {
    id: 76479,
    imdb_id: "tt1190634",
    title: "The Boys",
    original_title: "The Boys",
    overview: "Em um mundo onde super-her\xF3is corrompidos abusam de sua fama e poder, um grupo de vigilantes liderados por Billy Bruto decide expor a verdade sobre Os Sete e a Vought.",
    poster_path: getPosterUrl("tt1190634"),
    backdrop_path: getBackdropUrl("tt1190634"),
    release_date: "2019-07-26",
    vote_average: 8.7,
    vote_count: 14500,
    genre_ids: [10765, 28],
    media_type: "tv",
    number_of_seasons: 4,
    genres: [{ id: 10765, name: "Sci-Fi" }, { id: 28, name: "A\xE7\xE3o" }],
    stream_url: "",
    seasons: [
      makeExactSeason(76479, "tt1190634", 1, "Temporada 1", 8, [
        "O Nome do Jogo",
        "Cereja",
        "Pegue um Pouco",
        "A F\xEAmea da Esp\xE9cie",
        "Bom para a Alma",
        "Os Inocentes",
        "A Sociedade da Autopreserva\xE7\xE3o",
        "Voc\xEA Me Encontrou"
      ], 58),
      makeExactSeason(76479, "tt1190634", 2, "Temporada 2", 8, [
        "A Grande Corrida",
        "Prepara\xE7\xE3o Adequada",
        "Pelas Colinas com as Espadas de Mil Homens",
        "Nada Igual no Mundo",
        "Temos que Ir Agora",
        "As Portas Fora",
        "O A\xE7ougueiro, o Padeiro e o Fabricante",
        "O Que Eu Sei"
      ], 60),
      makeExactSeason(76479, "tt1190634", 3, "Temporada 3", 8, [
        "Retalia\xE7\xE3o",
        "O \xDAnico Homem no C\xE9u",
        "Costa da Barb\xE1ria",
        "Glorioso Plano Quinquenal",
        "A \xDAltima Vez de Olhar para Este Mundo de Mentiras",
        "Herogasm",
        "Aqui Vem uma Vela para Iluminar sua Cama",
        "O Instante Incandescente"
      ], 62),
      makeExactSeason(76479, "tt1190634", 4, "Temporada 4", 8, [
        "Departamento de Truques Sujos",
        "A Vida Entre os Canalhas",
        "Manteremos a Bandeira Vermelha Aqui",
        "Sabedoria dos Antigos",
        "Cuidado com o Jabberwock, Meu Filho",
        "Neg\xF3cios Sujos",
        "O Infiltrado",
        "Final da Quarta Temporada"
      ], 62)
    ]
  },
  {
    id: 100088,
    imdb_id: "tt3581920",
    title: "The Last of Us",
    original_title: "The Last of Us",
    overview: "Vinte anos ap\xF3s a destrui\xE7\xE3o da civiliza\xE7\xE3o moderna por um fungo mortal, Joel \xE9 contratado para levar Ellie, uma jovem imune de 14 anos, para fora de uma zona de quarentena.",
    poster_path: getPosterUrl("tt3581920"),
    backdrop_path: getBackdropUrl("tt3581920"),
    release_date: "2023-01-15",
    vote_average: 8.8,
    vote_count: 11900,
    genre_ids: [18, 10765],
    media_type: "tv",
    number_of_seasons: 2,
    genres: [{ id: 18, name: "Drama" }, { id: 10765, name: "P\xF3s-Apocal\xEDptico" }],
    stream_url: "",
    seasons: [
      makeExactSeason(100088, "tt3581920", 1, "Temporada 1", 9, [
        "Quando Estiver Perdido na Escurid\xE3o",
        "Infectados",
        "Muito, Muito Tempo",
        "Por Favor, Segure a Minha M\xE3o",
        "Suportar e Sobreviver",
        "Parentesco",
        "Deixados para Tr\xE1s",
        "Quando Mais Precisamos",
        "Procure pela Luz"
      ], 56),
      makeExactSeason(100088, "tt3581920", 2, "Temporada 2", 7, [
        "Dias Futuros",
        "Atrav\xE9s do Vale",
        "O Caminho",
        "Dia Um em Seattle",
        "Sinta o Amor Dela",
        "O Pre\xE7o",
        "Converg\xEAncia"
      ], 56)
    ]
  },
  {
    id: 1399,
    imdb_id: "tt0944947",
    title: "Game of Thrones: Guerra dos Tronos",
    original_title: "Game of Thrones",
    overview: "Nove fam\xEDlias nobres disputam o controle das terras m\xEDticas de Westeros e o Trono de Ferro, enquanto um inimigo ancestral desperta al\xE9m da Muralha.",
    poster_path: getPosterUrl("tt0944947"),
    backdrop_path: getBackdropUrl("tt0944947"),
    release_date: "2011-04-17",
    vote_average: 9.2,
    vote_count: 23e3,
    genre_ids: [10765, 18, 10759],
    media_type: "tv",
    number_of_seasons: 8,
    genres: [{ id: 10765, name: "Fantasia" }, { id: 18, name: "Drama" }],
    stream_url: "",
    seasons: [
      makeExactSeason(1399, "tt0944947", 1, "Temporada 1", 10, [
        "O Inverno Est\xE1 Chegando",
        "A Estrada do Rei",
        "Lorde Snow",
        "Aleijados, Bastardos e Coisas Partidas",
        "O Lobo e o Le\xE3o",
        "Uma Coroa Dourada",
        "Voc\xEA Ganha ou Voc\xEA Morre",
        "A Ponta Afiada",
        "Baelor",
        "Fogo e Sangue"
      ], 56),
      makeExactSeason(1399, "tt0944947", 2, "Temporada 2", 10, [
        "O Norte Se Lembra",
        "As Terras da Noite",
        "O Que Est\xE1 Morto N\xE3o Pode Morrer",
        "Jardim de Ossos",
        "O Fantasma de Harrenhal",
        "Os Deuses Antigos e os Novos",
        "Um Homem Sem Honra",
        "O Pr\xEDncipe de Winterfell",
        "\xC1gua Negra",
        "Valar Morghulis"
      ], 56),
      makeExactSeason(1399, "tt0944947", 3, "Temporada 3", 10, [
        "Valar Dohaeris",
        "Asas Escuras, Palavras Escuras",
        "Caminhada da Puni\xE7\xE3o",
        "E Agora Sua Patrulha Terminou",
        "Beijado pelo Fogo",
        "A Escalada",
        "O Urso e a Bela Donzela",
        "Segundos Filhos",
        "As Chuvas de Castamere",
        "Mhysa"
      ], 57),
      makeExactSeason(1399, "tt0944947", 4, "Temporada 4", 10, [
        "Duas Espadas",
        "O Le\xE3o e a Rosa",
        "Quebradora de Correntes",
        "Cumpridora de Promessas",
        "Primeiro de Seu Nome",
        "As Leis dos Deuses e dos Homens",
        "O P\xE1ssaro Zombeteiro",
        "A Montanha e a V\xEDbora",
        "Os Patrulheiros da Muralha",
        "As Crian\xE7as"
      ], 57),
      makeExactSeason(1399, "tt0944947", 5, "Temporada 5", 10, [
        "As Guerras Que Vir\xE3o",
        "A Casa do Preto e Branco",
        "Alto Pardal",
        "Filhos da Harpia",
        "Mate o Menino",
        "Insubmisso, N\xE3o Curvado, N\xE3o Quebrado",
        "O Dom",
        "Durolar",
        "A Dan\xE7a dos Drag\xF5es",
        "Miseric\xF3rdia da M\xE3e"
      ], 57),
      makeExactSeason(1399, "tt0944947", 6, "Temporada 6", 10, [
        "A Mulher Vermelha",
        "Lar",
        "Quebrador de Juramentos",
        "Livro do Estranho",
        "A Porta",
        "Sangue do Meu Sangue",
        "O Homem Quebrado",
        "Ningu\xE9m",
        "A Batalha dos Bastardos",
        "Os Ventos do Inverno"
      ], 59),
      makeExactSeason(1399, "tt0944947", 7, "Temporada 7", 7, [
        "Pedra do Drag\xE3o",
        "Nascida da Tormenta",
        "A Justi\xE7a da Rainha",
        "Os Despojos da Guerra",
        "Atalaialeste",
        "Al\xE9m da Muralha",
        "O Drag\xE3o e o Lobo"
      ], 63),
      makeExactSeason(1399, "tt0944947", 8, "Temporada 8", 6, [
        "Winterfell",
        "Um Cavaleiro dos Sete Reinos",
        "A Longa Noite",
        "Os \xDAltimos dos Starks",
        "Os Sinos",
        "O Trono de Ferro"
      ], 75)
    ]
  },
  {
    id: 94997,
    imdb_id: "tt11198330",
    title: "A Casa do Drag\xE3o",
    original_title: "House of the Dragon",
    overview: "Duzentos anos antes dos eventos de Game of Thrones, a Casa Targaryen vive o auge de seu poder at\xE9 que a disputa pelo Trono de Ferro desencadeia a sangrenta Dan\xE7a dos Drag\xF5es.",
    poster_path: getPosterUrl("tt11198330"),
    backdrop_path: getBackdropUrl("tt11198330"),
    release_date: "2022-08-21",
    vote_average: 8.4,
    vote_count: 9200,
    genre_ids: [10765, 18, 28],
    media_type: "tv",
    number_of_seasons: 2,
    genres: [{ id: 10765, name: "Fantasia" }, { id: 18, name: "Drama" }],
    stream_url: "",
    seasons: [
      makeExactSeason(94997, "tt11198330", 1, "Temporada 1", 10, [
        "Os Herdeiros do Drag\xE3o",
        "O Pr\xEDncipe Rebelde",
        "O Segundo de Seu Nome",
        "O Rei do Mar Estreito",
        "Iluminamos o Caminho",
        "A Princesa e a Rainha",
        "Driftmark",
        "O Senhor das Mar\xE9s",
        "O Conselho Verde",
        "A Rainha Negra"
      ], 60),
      makeExactSeason(94997, "tt11198330", 2, "Temporada 2", 8, [
        "Um Filho por um Filho",
        "Rhaenyra, a Cruel",
        "O Moinho Flamejante",
        "O Drag\xE3o Vermelho e o Dourado",
        "Regente",
        "O Povo Comum",
        "A Semeadura Vermelha",
        "A Rainha Que Sempre Foi"
      ], 64)
    ]
  },
  // =========================================================================
  // --- ANIMES COM CONTAGEM EXATA DE EPISÓDIOS REAIS ---
  // =========================================================================
  {
    id: 85937,
    imdb_id: "tt9335498",
    title: "Demon Slayer: Kimetsu no Yaiba",
    original_title: "\u9B3C\u6EC5\u306E\u5203",
    overview: "No Jap\xE3o da era Taisho, Tanjiro Kamado encontra sua fam\xEDlia atacada por dem\xF4nios e sua irm\xE3 Nezuko transformada, iniciando uma jornada como Ca\xE7ador de Dem\xF4nios.",
    poster_path: getPosterUrl("tt9335498"),
    backdrop_path: getBackdropUrl("tt9335498"),
    release_date: "2019-04-06",
    vote_average: 8.8,
    vote_count: 9800,
    genre_ids: [16, 10759, 10765],
    media_type: "anime",
    number_of_seasons: 4,
    genres: [{ id: 16, name: "Anime" }, { id: 10759, name: "A\xE7\xE3o & Aventura" }],
    stream_url: "",
    seasons: [
      makeExactSeason(85937, "tt9335498", 1, "Temporada 1: Determina\xE7\xE3o Inabal\xE1vel (26 eps)", 26, [
        "Crueldade",
        "O Treinador Sakonji Urokodaki",
        "Sabito e Makomo",
        "Sele\xE7\xE3o Final",
        "Meu Pr\xF3prio A\xE7o",
        "Espadachim com um Dem\xF4nio",
        "Muzan Kibutsuji",
        "O Feiti\xE7o do Sangue Sedutor",
        "Dem\xF4nio da Temari e Dem\xF4nio da Flecha",
        "Sempre Juntos",
        "A Mans\xE3o Tsuzumi",
        "O Javali Mostra Suas Presas",
        "Algo Mais Importante que a Vida",
        "A Casa com o Bras\xE3o de Glic\xEDnias",
        "Monte Natagumo",
        "Deixando Algu\xE9m Ir na Frente",
        "Voc\xEA Deve Dominar Uma \xDAnica Coisa",
        "Um La\xE7o Forjado",
        "Hinokami",
        "Fam\xEDlia de Faz-de-Conta",
        "Contra as Regras do Esquadr\xE3o",
        "O Mestre da Mans\xE3o",
        "Reuni\xE3o dos Hashiras",
        "Treinamento de Reabilita\xE7\xE3o",
        "Tsuguko, Kanao Tsuyuri",
        "Nova Miss\xE3o"
      ], 24),
      makeExactSeason(85937, "tt9335498", 2, "Temporada 2: Trem Infinito & Distrito do Entretenimento (18 eps)", 18, [
        "Kyojuro Rengoku, o Hashira das Chamas",
        "Sono Profundo",
        "Deveria Ter Sido",
        "Insulto",
        "Em Frente!",
        "Akaza",
        "Incendeie Seu Cora\xE7\xE3o",
        "Tengen Uzui, o Hashira do Som",
        "Infiltrando-se no Distrito do Entretenimento",
        "O Que Voc\xEA \xC9?",
        "Esta Noite",
        "As Coisas V\xE3o Ficar Extravagantes!",
        "Mem\xF3rias Sobrepostas",
        "Transforma\xE7\xE3o",
        "Reunindo-se",
        "Derrotando um Lua Superior",
        "Nunca Desistir",
        "N\xE3o Importa Quantas Vidas"
      ], 24),
      makeExactSeason(85937, "tt9335498", 3, "Temporada 3: Vila dos Ferreiros (11 eps)", 11, [
        "O Sonho de Algu\xE9m",
        "Yoriichi Tipo Zero",
        "Uma Espada de Mais de 300 Anos",
        "Obrigado, Tokito",
        "Espada Vermelha Brilhante",
        "Voc\xEA N\xE3o Vai Se Tornar um Hashira?",
        "Vil\xE3o Horr\xEDvel",
        'O "Mu" de Muichiro',
        "Muichiro Tokito, o Hashira da N\xE9voa",
        "Mitsuri Kanroji, a Hashira do Amor",
        "Um La\xE7o Conectado: Amanhecer e Primeira Luz"
      ], 25),
      makeExactSeason(85937, "tt9335498", 4, "Temporada 4: Treinamento dos Hashiras (8 eps)", 8, [
        "Para Derrotar Muzan Kibutsuji",
        "A Dor do Hashira da \xC1gua Giyu Tomioka",
        "Tanjiro Totalmente Recuperado!",
        "Para Trazer um Sorriso ao Rosto",
        "At\xE9 Comer Dem\xF4nios...",
        "O Mais Forte do Esquadr\xE3o de Ca\xE7adores",
        "Gyomei Himejima, o Hashira da Rocha",
        "Os Hashiras Se Re\xFAnem"
      ], 25)
    ]
  },
  {
    id: 1429,
    imdb_id: "tt2560140",
    title: "Attack on Titan: Ataque dos Tit\xE3s",
    original_title: "\u9032\u6483\u306E\u5DE8\u4EBA",
    overview: "Ap\xF3s sua cidade natal ser destru\xEDda por Tit\xE3s colossais, Eren Jaeger jura libertar a humanidade e se alista na Tropa de Explora\xE7\xE3o.",
    poster_path: getPosterUrl("tt2560140"),
    backdrop_path: getBackdropUrl("tt2560140"),
    release_date: "2013-04-07",
    vote_average: 9.1,
    vote_count: 18500,
    genre_ids: [16, 10759, 10765],
    media_type: "anime",
    number_of_seasons: 4,
    genres: [{ id: 16, name: "Anime" }, { id: 10759, name: "A\xE7\xE3o" }],
    stream_url: "",
    seasons: [
      makeExactSeason(1429, "tt2560140", 1, "Temporada 1 (25 eps)", 25, [
        "Para Voc\xEA, 2.000 Anos no Futuro",
        "Aquele Dia",
        "Uma Luz Fraca em Meio ao Desespero",
        "A Noite da Cerim\xF4nia de Despedida",
        "Primeira Batalha",
        "O Mundo que a Garota Viu"
      ], 24),
      makeExactSeason(1429, "tt2560140", 2, "Temporada 2 (12 eps)", 12, [
        "O Tit\xE3 Bestial",
        "Estou em Casa",
        "Rumo ao Sudoeste",
        "Soldado",
        "Historia",
        "Guerreiro",
        "Combate Corpo a Corpo",
        "Os Ca\xE7adores",
        "Abertura",
        "Crian\xE7as",
        "Investida",
        "Grito"
      ], 24),
      makeExactSeason(1429, "tt2560140", 3, "Temporada 3 (22 eps)", 22, [
        "Sinal de Fuma\xE7a",
        "Dor",
        "Hist\xF3rias Antigas",
        "Confian\xE7a",
        "Resposta",
        "Pecado"
      ], 24),
      makeExactSeason(1429, "tt2560140", 4, "Temporada 4: The Final Season (30 eps)", 30, [
        "Do Outro Lado do Mar",
        "Trem da Meia-Noite",
        "A Porta da Esperan\xE7a",
        "De M\xE3o em M\xE3o",
        "Declara\xE7\xE3o de Guerra",
        "O Tit\xE3 Martelo de Guerra"
      ], 25)
    ]
  },
  {
    id: 95479,
    imdb_id: "tt12343534",
    title: "Jujutsu Kaisen",
    original_title: "\u546A\u8853\u5EFB\u6226",
    overview: "Yuji Itadori engole um dedo amaldi\xE7oado de Ryomen Sukuna para salvar seus amigos e ingressa na Escola T\xE9cnica de Feiti\xE7aria de T\xF3quio.",
    poster_path: getPosterUrl("tt12343534"),
    backdrop_path: getBackdropUrl("tt12343534"),
    release_date: "2020-10-03",
    vote_average: 8.7,
    vote_count: 6100,
    genre_ids: [16, 10759, 10765],
    media_type: "anime",
    number_of_seasons: 2,
    genres: [{ id: 16, name: "Anime" }, { id: 10759, name: "A\xE7\xE3o Sobrenatural" }],
    stream_url: "",
    seasons: [
      makeExactSeason(95479, "tt12343534", 1, "Temporada 1 (24 eps)", 24, [
        "Ryomen Sukuna",
        "Por Mim Mesmo",
        "Garota de A\xE7o",
        "\xDAtero Amaldi\xE7oado Deve Morrer",
        "\xDAtero Amaldi\xE7oado - Parte 2",
        "Depois da Chuva"
      ], 24),
      makeExactSeason(95479, "tt12343534", 2, "Temporada 2: Invent\xE1rio Oculto & Shibuya (23 eps)", 23, [
        "Invent\xE1rio Oculto",
        "Invent\xE1rio Oculto 2",
        "Invent\xE1rio Oculto 3",
        "Invent\xE1rio Oculto 4",
        "Morte Prematura",
        "\xC9 Assim Que \xC9",
        "Festival Noturno",
        "O Incidente de Shibuya"
      ], 24)
    ]
  },
  {
    id: 13916,
    imdb_id: "tt0877057",
    title: "Death Note",
    original_title: "\u30C7\u30B9\u30CE\u30FC\u30C8",
    overview: "Light Yagami encontra um caderno sobrenatural capaz de matar qualquer pessoa cujo nome seja escrito nele e trava uma batalha genial contra o detetive L.",
    poster_path: getPosterUrl("tt0877057"),
    backdrop_path: getBackdropUrl("tt0877057"),
    release_date: "2006-10-04",
    vote_average: 8.9,
    vote_count: 14200,
    genre_ids: [16, 9648, 18],
    media_type: "anime",
    number_of_seasons: 1,
    genres: [{ id: 16, name: "Anime" }, { id: 9648, name: "Mist\xE9rio Psicol\xF3gico" }],
    stream_url: "",
    seasons: [
      makeExactSeason(13916, "tt0877057", 1, "Temporada Completa (37 eps)", 37, [
        "Renascimento",
        "Confronto",
        "Negocia\xE7\xF5es",
        "Persegui\xE7\xE3o",
        "T\xE1ticas",
        "Ferida Aberta",
        "Nublado",
        "Vislumbre"
      ], 23)
    ]
  },
  {
    id: 209867,
    imdb_id: "tt21209876",
    title: "Solo Leveling",
    original_title: "\uB098 \uD63C\uC790\uB9CC \uB808\uBCA8\uC5C5",
    overview: "Sung Jinwoo, o ca\xE7ador mais fraco da humanidade, desperta um sistema exclusivo que permite a ele subir de n\xEDvel sem limites.",
    poster_path: getPosterUrl("tt21209876"),
    backdrop_path: getBackdropUrl("tt21209876"),
    release_date: "2024-01-07",
    vote_average: 8.7,
    vote_count: 4200,
    genre_ids: [16, 10759, 10765],
    media_type: "anime",
    number_of_seasons: 2,
    genres: [{ id: 16, name: "Anime" }, { id: 10759, name: "A\xE7\xE3o Fant\xE1stica" }],
    stream_url: "",
    seasons: [
      makeExactSeason(209867, "tt21209876", 1, "Temporada 1 (12 eps)", 12, [
        "J\xE1 Estou Acostumado",
        "Se Eu Tivesse Mais Uma Chance",
        "\xC9 Como um Jogo",
        "Tenho que Ficar Mais Forte",
        "Um Bom Neg\xF3cio",
        "A Verdadeira Ca\xE7ada Come\xE7a",
        "Vamos Ver At\xE9 Onde Posso Ir",
        "Isso \xE9 Frustrante",
        "Voc\xEA Escondeu Suas Habilidades",
        "O Que \xE9 Isso, um Piquenique?",
        "Um Cavaleiro que Defende um Trono Vazio",
        "Erga-se (Arise)"
      ], 24),
      makeExactSeason(209867, "tt21209876", 2, "Temporada 2: Erga-se das Sombras (13 eps)", 13, [
        "Voc\xEA N\xE3o \xC9 Rank E, N\xE9?",
        "Suponho que Voc\xEA N\xE3o Esteja Consciente",
        "Ainda Falta Muito",
        "Preciso Parar de Fingir",
        "\xC9 Isso Que Fomos Treinados Para Fazer"
      ], 24)
    ]
  },
  {
    id: 94605,
    imdb_id: "tt11126994",
    title: "Arcane",
    original_title: "Arcane: League of Legends",
    overview: "Em meio ao conflito entre as cidades-g\xEAmeas de Piltover e Zaun, as irm\xE3s Vi e Jinx lutam em lados opostos de uma guerra entre tecnologias m\xE1gicas.",
    poster_path: getPosterUrl("tt11126994"),
    backdrop_path: getBackdropUrl("tt11126994"),
    release_date: "2021-11-06",
    vote_average: 9,
    vote_count: 9100,
    genre_ids: [16, 10759, 10765],
    media_type: "anime",
    number_of_seasons: 2,
    genres: [{ id: 16, name: "Anima\xE7\xE3o" }, { id: 10759, name: "Sci-Fi Steampunk" }],
    stream_url: "",
    seasons: [
      makeExactSeason(94605, "tt11126994", 1, "Temporada 1 (9 eps)", 9, [
        "Entrando na Brincadeira",
        "Alguns Mist\xE9rios Devem Permanecer Intocados",
        "A Viol\xEAncia Bruta Necess\xE1ria para a Mudan\xE7a",
        "Feliz Dia do Progresso!",
        "Todo Mundo Quer Ser Meu Inimigo",
        "Quando Essas Paredes Desabam",
        "O Garoto Salvador",
        "\xC1gua e \xD3leo",
        "O Monstro Que Voc\xEA Criou"
      ], 42),
      makeExactSeason(94605, "tt11126994", 2, "Temporada 2 (9 eps)", 9, [
        "Pesada \xE9 a Coroa",
        "Ver Tudo Queimar",
        "Finalmente Acertou o Nome",
        "Pinte a Cidade de Azul",
        "Bolhas e Pedras",
        "A Mensagem Oculta no Padr\xE3o",
        "Fingir que \xE9 a Primeira Vez",
        "Matar \xE9 um Ciclo",
        "A Sujeira Sob Suas Unhas"
      ], 42)
    ]
  },
  {
    id: 46298,
    imdb_id: "tt2098220",
    title: "Hunter x Hunter",
    original_title: "HUNTER\xD7HUNTER",
    overview: "Gon Freecss descobre que seu pai \xE9 um lend\xE1rio Hunter e parte em uma jornada inesquec\xEDvel ao lado de Killua, Kurapika e Leorio.",
    poster_path: getPosterUrl("tt2098220"),
    backdrop_path: getBackdropUrl("tt2098220"),
    release_date: "2011-10-02",
    vote_average: 9,
    vote_count: 11500,
    genre_ids: [16, 10759, 10765],
    media_type: "anime",
    number_of_seasons: 6,
    genres: [{ id: 16, name: "Anime" }, { id: 10759, name: "Aventura Shonen" }],
    stream_url: "",
    seasons: [
      makeExactSeason(46298, "tt2098220", 1, "Temporada 1: Exame Hunter (26 eps)", 26, [], 23),
      makeExactSeason(46298, "tt2098220", 2, "Temporada 2: Arena Celestial (12 eps)", 12, [], 23),
      makeExactSeason(46298, "tt2098220", 3, "Temporada 3: Trupe Fantasma em Yorkshin (20 eps)", 20, [], 23),
      makeExactSeason(46298, "tt2098220", 4, "Temporada 4: Greed Island (17 eps)", 17, [], 23),
      makeExactSeason(46298, "tt2098220", 5, "Temporada 5: Formigas Quimera (61 eps)", 61, [], 23),
      makeExactSeason(46298, "tt2098220", 6, "Temporada 6: Elei\xE7\xE3o Hunter (12 eps)", 12, [], 23)
    ]
  },
  {
    id: 37854,
    imdb_id: "tt0388629",
    title: "One Piece",
    original_title: "\u30EF\u30F3\u30D4\u30FC\u30B9",
    overview: "Monkey D. Luffy navega com seus companheiros Piratas do Chap\xE9u de Palha atrav\xE9s da Grand Line em busca do tesouro supremo One Piece.",
    poster_path: getPosterUrl("tt0388629"),
    backdrop_path: getBackdropUrl("tt0388629"),
    release_date: "1999-10-20",
    vote_average: 8.9,
    vote_count: 12e3,
    genre_ids: [16, 10759, 35],
    media_type: "anime",
    number_of_seasons: 13,
    genres: [{ id: 16, name: "Anime" }, { id: 10759, name: "Aventura \xC9pica" }],
    stream_url: ""
  },
  {
    id: 46260,
    imdb_id: "tt0988824",
    title: "Naruto Shippuden",
    original_title: "NARUTO -\u30CA\u30EB\u30C8- \u75BE\u98A8\u4F1D",
    overview: "Naruto Uzumaki retorna \xE0 Vila da Folha ap\xF3s dois anos e meio de treinamento com Jiraiya, determinado a resgatar Sasuke e deter a Akatsuki.",
    poster_path: getPosterUrl("tt0988824"),
    backdrop_path: getBackdropUrl("tt0988824"),
    release_date: "2007-02-15",
    vote_average: 8.8,
    vote_count: 14800,
    genre_ids: [16, 10759, 10765],
    media_type: "anime",
    number_of_seasons: 21,
    genres: [{ id: 16, name: "Anime" }, { id: 10759, name: "A\xE7\xE3o Ninja" }],
    stream_url: ""
  },
  {
    id: 12971,
    imdb_id: "tt0214341",
    title: "Dragon Ball Z",
    original_title: "\u30C9\u30E9\u30B4\u30F3\u30DC\u30FC\u30EBZ",
    overview: "Goku descobre suas origens Saiyajin e defende a Terra ao lado dos Guerreiros Z contra Freeza, Cell e Majin Boo.",
    poster_path: getPosterUrl("tt0214341"),
    backdrop_path: getBackdropUrl("tt0214341"),
    release_date: "1989-04-26",
    vote_average: 8.8,
    vote_count: 12600,
    genre_ids: [16, 10759, 10765],
    media_type: "anime",
    number_of_seasons: 9,
    genres: [{ id: 16, name: "Anime" }, { id: 10759, name: "A\xE7\xE3o" }],
    stream_url: ""
  }
];
var TMDBService = class {
  constructor() {
    this.dynamicCache = /* @__PURE__ */ new Map();
    this.imdbMap = /* @__PURE__ */ new Map();
    this.ptBrCache = /* @__PURE__ */ new Map();
    this.cinemetaSeriesEnriched = /* @__PURE__ */ new Set();
    this.cinemetaLoaded = false;
    RAW_CATALOG.forEach((item) => {
      this.dynamicCache.set(item.id, item);
      if (item.imdb_id) {
        this.imdbMap.set(item.imdb_id, item);
        this.ptBrCache.set(item.imdb_id, {
          titlePtBr: item.title,
          originalTitle: item.original_title,
          overviewPtBr: item.overview,
          runtimeMinutes: item.runtime,
          seasonCount: item.number_of_seasons
        });
      }
    });
    this.ensureCinemetaMegaCatalog().catch(() => {
    });
  }
  /**
   * Traduz e enriquece em lote uma lista de títulos via IMDb GraphQL (x-imdb-user-country: BR / pt-BR)
   * garantindo nomes de filmes em Português, sinopse em Português e quantidade real de temporadas!
   */
  async localizeItemsToPtBr(items) {
    const missingImdbIds = Array.from(
      new Set(
        items.map((i) => i.imdb_id).filter((id) => Boolean(id && id.startsWith("tt") && !this.ptBrCache.has(id)))
      )
    );
    for (let i = 0; i < missingImdbIds.length; i += 25) {
      const batch = missingImdbIds.slice(i, i + 25);
      const idsLiteral = batch.map((id) => `"${id}"`).join(", ");
      const gql = {
        query: `{ titles(ids: [${idsLiteral}]) {
          id
          titleText { text }
          originalTitleText { text }
          plot { plotText { plainText } }
          runtime { seconds }
          episodes { seasons { number } }
        } }`
      };
      try {
        const res = await fetch("https://caching.graphql.imdb.com/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept-Language": "pt-BR,pt;q=0.9",
            "x-imdb-user-country": "BR",
            "x-imdb-user-language": "pt-BR",
            "x-imdb-client-name": "imdb-web-next"
          },
          body: JSON.stringify(gql),
          signal: AbortSignal.timeout(4e3)
        });
        if (res.ok) {
          const payload = await res.json();
          const titles = payload?.data?.titles || [];
          for (const t of titles) {
            if (!t?.id) continue;
            const validSeasons = Array.isArray(t.episodes?.seasons) ? t.episodes.seasons.filter((s) => typeof s?.number === "number" && s.number > 0) : [];
            this.ptBrCache.set(t.id, {
              titlePtBr: t.titleText?.text || "",
              originalTitle: t.originalTitleText?.text || t.titleText?.text || "",
              overviewPtBr: t.plot?.plotText?.plainText || void 0,
              runtimeMinutes: t.runtime?.seconds ? Math.round(t.runtime.seconds / 60) : void 0,
              seasonCount: validSeasons.length > 0 ? validSeasons.length : void 0
            });
          }
        }
      } catch {
      }
    }
    for (const item of items) {
      if (!item.imdb_id) continue;
      const loc = this.ptBrCache.get(item.imdb_id);
      if (!loc) continue;
      if (loc.titlePtBr) {
        item.title = loc.titlePtBr;
      }
      if (loc.originalTitle) {
        item.original_title = loc.originalTitle;
      }
      if (loc.overviewPtBr && (!item.overview || item.overview.includes("dispon\xEDvel") || item.overview.includes("indexado") || /[a-zA-Z]{4,}\s+the\s+[a-zA-Z]{3,}/i.test(item.overview))) {
        item.overview = loc.overviewPtBr;
      }
      if (loc.runtimeMinutes && (!item.runtime || item.runtime === 110 || item.runtime === 115)) {
        item.runtime = loc.runtimeMinutes;
      }
      if (loc.seasonCount && (item.media_type === "tv" || item.media_type === "anime")) {
        item.number_of_seasons = loc.seasonCount;
      }
      this.dynamicCache.set(item.id, item);
      this.imdbMap.set(item.imdb_id, item);
    }
  }
  /**
   * Sincroniza a lista EXATA e completa de temporadas e episódios reais a partir do Cinemeta
   * (ignorando especiais season === 0 para nunca inflar a Temporada 1)
   */
  async enrichSeriesExactEpisodes(item) {
    if (item.media_type !== "tv" && item.media_type !== "anime" || !item.imdb_id || this.cinemetaSeriesEnriched.has(item.imdb_id)) {
      return item;
    }
    try {
      const metaRes = await fetch(
        `https://v3-cinemeta.strem.io/meta/series/${item.imdb_id}.json`,
        { signal: AbortSignal.timeout(4200) }
      );
      if (metaRes.ok) {
        const metaData = await metaRes.json();
        const videos = metaData.meta?.videos;
        if (Array.isArray(videos) && videos.length > 0) {
          const seasonMap = /* @__PURE__ */ new Map();
          for (const v of videos) {
            const seasonNum = Number(v.season);
            if (!Number.isFinite(seasonNum) || seasonNum <= 0) continue;
            const epNum = Number(v.episode ?? v.number);
            if (!Number.isFinite(epNum) || epNum <= 0) continue;
            if (!seasonMap.has(seasonNum)) {
              seasonMap.set(seasonNum, /* @__PURE__ */ new Map());
            }
            const existingEp = item.seasons?.find((s) => s.seasonNumber === seasonNum)?.episodes.find((e) => e.episodeNumber === epNum);
            const epTitle = existingEp && !existingEp.title.startsWith("Epis\xF3dio ") ? existingEp.title : v.name || v.title || `Epis\xF3dio ${epNum}`;
            seasonMap.get(seasonNum).set(epNum, {
              id: item.id * 1e4 + seasonNum * 100 + epNum,
              episodeNumber: epNum,
              seasonNumber: seasonNum,
              title: epTitle,
              overview: existingEp?.overview || v.overview || v.description || `Epis\xF3dio ${epNum} da Temporada ${seasonNum} de ${item.title}.`,
              durationMinutes: existingEp?.durationMinutes || (item.media_type === "anime" ? 24 : 48),
              stillPath: v.thumbnail || item.backdrop_path,
              streamUrl: `/api/stream/${item.id}?season=${seasonNum}&episode=${epNum}`
            });
          }
          if (seasonMap.size > 0) {
            const builtSeasons = Array.from(seasonMap.entries()).sort(([a], [b]) => a - b).map(([seasonNum, epMap]) => {
              const eps = Array.from(epMap.values()).sort(
                (a, b) => a.episodeNumber - b.episodeNumber
              );
              const existingSeason = item.seasons?.find((s) => s.seasonNumber === seasonNum);
              const cleanBaseName = existingSeason?.name?.split("(")[0]?.trim();
              return {
                seasonNumber: seasonNum,
                name: cleanBaseName || `Temporada ${seasonNum}`,
                episodeCount: eps.length,
                episodes: eps
              };
            });
            item.seasons = builtSeasons;
            item.number_of_seasons = builtSeasons.length;
          }
        }
        this.cinemetaSeriesEnriched.add(item.imdb_id);
        this.dynamicCache.set(item.id, item);
        this.imdbMap.set(item.imdb_id, item);
      }
    } catch (err) {
      console.warn("[TMDBService] Aviso ao enriquecer epis\xF3dios exatos:", err.message);
    }
    return item;
  }
  async getCatalog(category, page = 1) {
    if (page > 1) {
      return this.fetchPaginatedCatalog(category, page);
    }
    const all = Array.from(this.dynamicCache.values());
    switch (category) {
      case "trending":
        return all.slice(0, 24);
      case "latest":
        return all.filter(
          (i) => (i.release_date || "").startsWith("2026") || (i.release_date || "").startsWith("2025")
        ).sort((a, b) => (b.release_date || "").localeCompare(a.release_date || "")).slice(0, 24);
      case "movies":
        return all.filter((i) => i.media_type === "movie").slice(0, 300);
      case "tv":
        return all.filter((i) => i.media_type === "tv").slice(0, 300);
      case "anime":
        return all.filter(
          (i) => i.media_type === "anime" || i.media_type === "tv" && i.genres?.some((g) => g.name.toLowerCase().includes("anime"))
        ).slice(0, 300);
      case "animation":
        return all.filter(
          (i) => i.media_type === "movie" && (i.genre_ids?.includes(16) || i.genres?.some((g) => g.name.toLowerCase().includes("anima")))
        ).slice(0, 300);
      case "top_rated":
        return [...all].sort((a, b) => b.vote_average - a.vote_average).slice(0, 20);
      case "action":
        return all.filter((i) => i.genre_ids?.includes(28) || i.genres?.some((g) => g.id === 28)).slice(0, 40);
      case "comedy":
        return all.filter((i) => i.genre_ids?.includes(35) || i.genres?.some((g) => g.id === 35)).slice(0, 40);
      case "scifi":
        return all.filter((i) => i.genre_ids?.includes(878) || i.genres?.some((g) => g.id === 878)).slice(0, 40);
      case "mega":
      default:
        return all.slice(0, 180);
    }
  }
  upsertFromCinemetaMeta(m, fallbackMediaType) {
    if (m.id && this.imdbMap.has(m.id)) {
      return this.imdbMap.get(m.id);
    }
    const numericId = parseInt(String(m.id || "").replace(/\D/g, "").slice(0, 8), 10) || Math.floor(8e5 + Math.random() * 19e4);
    if (this.dynamicCache.has(numericId)) {
      return this.dynamicCache.get(numericId);
    }
    const isAnime = fallbackMediaType === "tv" && (m.genres?.includes("Animation") || m.genres?.includes("Anime"));
    const item = {
      id: numericId,
      imdb_id: m.id,
      title: m.name,
      original_title: m.name,
      overview: m.description || `Dispon\xEDvel em streaming P2P com suporte a \xE1udio PT-BR.`,
      poster_path: m.poster || getPosterUrl(m.id),
      backdrop_path: m.background || getBackdropUrl(m.id),
      release_date: m.year ? `${String(m.year).slice(0, 4)}-01-01` : "2024-01-01",
      vote_average: parseFloat(m.imdbRating) || 7.6,
      vote_count: 1900,
      genre_ids: fallbackMediaType === "movie" ? [28, 18] : [18, 10765],
      media_type: isAnime ? "anime" : fallbackMediaType,
      runtime: fallbackMediaType === "movie" ? 115 : void 0,
      number_of_seasons: fallbackMediaType === "tv" ? 1 : void 0,
      genres: (m.genres || ["Cinema"]).map((g, i) => ({ id: i + 1, name: g })),
      stream_url: ""
    };
    this.dynamicCache.set(numericId, item);
    if (m.id) this.imdbMap.set(m.id, item);
    return item;
  }
  async fetchPaginatedCatalog(category, page) {
    const type = category === "tv" || category === "anime" ? "series" : "movie";
    const skip = Math.max(0, (page - 1) * 20);
    try {
      const res = await fetch(
        `https://v3-cinemeta.strem.io/catalog/${type}/top/skip=${skip}.json`,
        { signal: AbortSignal.timeout(4e3) }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.metas && Array.isArray(data.metas)) {
          const items = data.metas.map(
            (m) => this.upsertFromCinemetaMeta(m, type === "series" ? "tv" : "movie")
          );
          await this.localizeItemsToPtBr(items);
          return items;
        }
      }
    } catch (e) {
      console.warn(`[TMDBService] Falha ao paginar cat\xE1logo skip=${skip}:`, e.message);
    }
    return [];
  }
  async ensureCinemetaMegaCatalog() {
    if (this.cinemetaLoaded) return;
    try {
      const skips = [0, 20, 40];
      const moviePromises = skips.map(
        (s) => fetch(
          `https://v3-cinemeta.strem.io/catalog/movie/top${s === 0 ? "" : `/skip=${s}`}.json`,
          { signal: AbortSignal.timeout(4500) }
        ).then((r) => r.ok ? r.json() : null).catch(() => null)
      );
      const seriesPromises = skips.map(
        (s) => fetch(
          `https://v3-cinemeta.strem.io/catalog/series/top${s === 0 ? "" : `/skip=${s}`}.json`,
          { signal: AbortSignal.timeout(4500) }
        ).then((r) => r.ok ? r.json() : null).catch(() => null)
      );
      const [movieResults, seriesResults] = await Promise.all([
        Promise.all(moviePromises),
        Promise.all(seriesPromises)
      ]);
      const newlyAdded = [];
      movieResults.forEach((data) => {
        if (data?.metas && Array.isArray(data.metas)) {
          data.metas.forEach((m) => {
            newlyAdded.push(this.upsertFromCinemetaMeta(m, "movie"));
          });
        }
      });
      seriesResults.forEach((data) => {
        if (data?.metas && Array.isArray(data.metas)) {
          data.metas.forEach((m) => {
            newlyAdded.push(this.upsertFromCinemetaMeta(m, "tv"));
          });
        }
      });
      await this.localizeItemsToPtBr(newlyAdded);
      this.cinemetaLoaded = true;
    } catch (e) {
      console.warn("[TMDBService] Aviso ao carregar mega cat\xE1logo:", e.message);
    }
  }
  /**
   * Busca inteligente focada em Português (pt-BR):
   * 1. Ignora acentos, hífens e pontuação (ex: "poderoso chefao", "divertidamente", "homem aranha")
   * 2. Consulta IMDb Suggestion em pt-BR (encontra qualquer filme pelo nome brasileiro!) + Cinemeta
   * 3. Traduz todos os resultados retornados para o título oficial em Português
   */
  async search(query) {
    if (!query || !query.trim()) return RAW_CATALOG.slice(0, 12);
    const normQ = normalizeSearchText(query);
    const scoreMatch = (item) => {
      const normTitle = normalizeSearchText(item.title);
      const normOrig = normalizeSearchText(item.original_title);
      const normOverview = normalizeSearchText(item.overview);
      if (normTitle === normQ) return 1e3;
      if (normTitle.startsWith(normQ)) return 750;
      if (normTitle.includes(normQ)) return 550;
      if (normOrig === normQ) return 500;
      if (normOrig.startsWith(normQ)) return 380;
      if (normOrig.includes(normQ)) return 280;
      if (normOverview.includes(normQ)) return 100;
      return 0;
    };
    const localMatches = Array.from(this.dynamicCache.values()).filter(
      (item) => scoreMatch(item) > 0
    );
    try {
      const encodedQ = encodeURIComponent(query.trim());
      const [imdbPtRes, cinemetaMovies, cinemetaSeries] = await Promise.allSettled([
        fetch(`https://v3.sg.media-imdb.com/suggestion/x/${encodedQ}.json`, {
          headers: { "Accept-Language": "pt-BR,pt;q=0.9" },
          signal: AbortSignal.timeout(3500)
        }).then((r) => r.ok ? r.json() : null),
        fetch(`https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodedQ}.json`, {
          signal: AbortSignal.timeout(3500)
        }).then((r) => r.ok ? r.json() : null),
        fetch(`https://v3-cinemeta.strem.io/catalog/series/top/search=${encodedQ}.json`, {
          signal: AbortSignal.timeout(3500)
        }).then((r) => r.ok ? r.json() : null)
      ]);
      const onlineItems = [];
      if (imdbPtRes.status === "fulfilled" && Array.isArray(imdbPtRes.value?.d)) {
        for (const d of imdbPtRes.value.d.slice(0, 10)) {
          if (!d?.id || !String(d.id).startsWith("tt")) continue;
          const qid = String(d.qid || d.q || "").toLowerCase();
          if (qid.includes("video game") || qid.includes("podcast")) continue;
          if (this.imdbMap.has(d.id)) {
            onlineItems.push(this.imdbMap.get(d.id));
            continue;
          }
          const isSeries = qid.includes("tv") || qid.includes("series") || qid.includes("mini");
          const numericId = parseInt(String(d.id).replace(/\D/g, "").slice(0, 8), 10) || Math.floor(7e5 + Math.random() * 99e3);
          const newItem = {
            id: numericId,
            imdb_id: d.id,
            title: d.l || query,
            original_title: d.l || query,
            overview: d.s ? `Elenco principal: ${d.s}.` : "Dispon\xEDvel para streaming no Popoca.",
            poster_path: d.i?.imageUrl || getPosterUrl(d.id),
            backdrop_path: getBackdropUrl(d.id),
            release_date: d.y ? `${d.y}-01-01` : "2024-01-01",
            vote_average: 7.8,
            vote_count: 2500,
            genre_ids: isSeries ? [18, 10765] : [28, 18],
            media_type: isSeries ? "tv" : "movie",
            stream_url: ""
          };
          this.dynamicCache.set(numericId, newItem);
          this.imdbMap.set(d.id, newItem);
          onlineItems.push(newItem);
        }
      }
      if (cinemetaMovies.status === "fulfilled" && cinemetaMovies.value?.metas) {
        cinemetaMovies.value.metas.slice(0, 6).forEach((m) => {
          onlineItems.push(this.upsertFromCinemetaMeta(m, "movie"));
        });
      }
      if (cinemetaSeries.status === "fulfilled" && cinemetaSeries.value?.metas) {
        cinemetaSeries.value.metas.slice(0, 6).forEach((m) => {
          onlineItems.push(this.upsertFromCinemetaMeta(m, "tv"));
        });
      }
      await this.localizeItemsToPtBr(onlineItems);
      const seenIds = /* @__PURE__ */ new Set();
      const seenImdb = /* @__PURE__ */ new Set();
      const combined = [];
      for (const item of [...localMatches, ...onlineItems]) {
        if (seenIds.has(item.id)) continue;
        if (item.imdb_id && seenImdb.has(item.imdb_id)) continue;
        seenIds.add(item.id);
        if (item.imdb_id) seenImdb.add(item.imdb_id);
        combined.push(item);
      }
      combined.sort((a, b) => scoreMatch(b) - scoreMatch(a) || b.vote_count - a.vote_count);
      return combined;
    } catch {
      return localMatches.sort((a, b) => scoreMatch(b) - scoreMatch(a));
    }
  }
  /**
   * Sugestões instantâneas na barra de navegação com suporte completo aos nomes em Português
   */
  async getSuggestions(query) {
    if (!query || query.trim().length < 2) return [];
    const normQ = normalizeSearchText(query);
    let matches = Array.from(this.dynamicCache.values()).filter((m) => {
      const nt = normalizeSearchText(m.title);
      const no = normalizeSearchText(m.original_title);
      return nt.includes(normQ) || no.includes(normQ);
    });
    if (matches.length < 4) {
      matches = await this.search(query);
    } else {
      matches.sort((a, b) => {
        const aStarts = normalizeSearchText(a.title).startsWith(normQ) ? 1 : 0;
        const bStarts = normalizeSearchText(b.title).startsWith(normQ) ? 1 : 0;
        return bStarts - aStarts || b.vote_count - a.vote_count;
      });
    }
    return matches.slice(0, 7).map((m) => ({
      id: m.id,
      imdb_id: m.imdb_id,
      title: m.title,
      original_title: m.original_title,
      poster_path: m.poster_path,
      year: m.release_date ? m.release_date.slice(0, 4) : "",
      media_type: m.media_type,
      vote_average: m.vote_average
    }));
  }
  async getDetails(id, _type = "movie") {
    let item = this.dynamicCache.get(id) || RAW_CATALOG.find((m) => m.id === id) || null;
    if (!item) return null;
    await this.localizeItemsToPtBr([item]);
    if (item.media_type === "tv" || item.media_type === "anime") {
      item = await this.enrichSeriesExactEpisodes(item);
    }
    return item;
  }
  /**
   * Retorna os episódios exatos de uma temporada específica
   */
  async getSeasonEpisodes(seriesId, seasonNumber) {
    let item = this.dynamicCache.get(seriesId) || RAW_CATALOG.find((m) => m.id === seriesId);
    if (!item) return [];
    item = await this.enrichSeriesExactEpisodes(item);
    const existingSeason = item.seasons?.find((s) => s.seasonNumber === seasonNumber);
    if (existingSeason && existingSeason.episodes && existingSeason.episodes.length > 0) {
      return existingSeason.episodes;
    }
    return [];
  }
};
var tmdbService = new TMDBService();

// server/indexerService.ts
var SUPER_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://explodie.org:6969/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://p4p.arenabg.com:1337/announce",
  "udp://tracker.dler.org:6969/announce",
  "udp://opentracker.i2p.rocks:6969/announce",
  "udp://tracker.internetwarriors.net:1337/announce",
  "udp://tracker.leechers-paradise.org:6969/announce",
  "udp://coppersurfer.tk:6969/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
  "http://tracker.openbittorrent.com:80/announce"
];
var TRACKER_PROFILES = {
  "pt-br-stability": [
    ...SUPER_TRACKERS,
    "http://tracker.opentrackr.org:1337/announce",
    "udp://open.tracker.cl:1337/announce",
    "http://tracker.torrent.eu.org:451/announce",
    "http://tracker.dler.org:6969/announce",
    "udp://tracker.moeking.me:6969/announce",
    "https://tracker.tamersunion.org:443/announce",
    "udp://tracker.bittor.pw:1337/announce",
    "udp://tracker1.bt.moack.co.kr:2710/announce",
    "udp://tracker.therarbg.com:6969/announce",
    "http://tracker.bt4g.com:2095/announce",
    "wss://tracker.openwebtorrent.com",
    "wss://tracker.webtorrent.dev",
    "wss://tracker.files.fm:7073/announce"
  ],
  "ultra-speed": [
    ...SUPER_TRACKERS,
    "http://tracker.opentrackr.org:1337/announce",
    "udp://open.tracker.cl:1337/announce",
    "http://p4p.arenabg.com:1337/announce",
    "http://tracker.bt4g.com:2095/announce",
    "https://tracker.tamersunion.org:443/announce",
    "udp://tracker.moeking.me:6969/announce",
    "udp://tracker.nyaa.vc:6969/announce",
    "wss://tracker.openwebtorrent.com",
    "wss://tracker.btorrent.xyz"
  ],
  "global-balanced": [
    ...SUPER_TRACKERS,
    "http://tracker.opentrackr.org:1337/announce",
    "udp://open.tracker.cl:1337/announce",
    "udp://tracker.nyaa.vc:6969/announce",
    "http://tracker.torrent.eu.org:451/announce",
    "https://tracker.tamersunion.org:443/announce",
    "udp://tracker.moeking.me:6969/announce",
    "http://p4p.arenabg.com:1337/announce",
    "wss://tracker.openwebtorrent.com"
  ]
};
function getTrackersForPriority(mode = "pt-br-stability") {
  const profile = TRACKER_PROFILES[mode] || TRACKER_PROFILES["pt-br-stability"];
  return Array.from(/* @__PURE__ */ new Set([...SUPER_TRACKERS, ...profile]));
}
function buildMagnet(infoHash, name, trackerPriority = "pt-br-stability") {
  const trackers = getTrackersForPriority(trackerPriority);
  const tr = trackers.map((t) => `&tr=${encodeURIComponent(t)}`).join("");
  return `magnet:?xt=urn:btih:${infoHash.toLowerCase()}&dn=${encodeURIComponent(name)}${tr}`;
}
function sanitizeInfoHash(raw) {
  if (!raw) return "";
  const match = raw.match(/([a-fA-F0-9]{40})/);
  if (match) return match[1].toLowerCase();
  const b32Match = raw.match(/([a-zA-Z2-7]{32})/);
  if (b32Match) {
    return base32ToHex(b32Match[1]);
  }
  return raw.replace(/[^a-fA-F0-9]/g, "").slice(0, 40).toLowerCase().padEnd(40, "0");
}
function base32ToHex(base32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  const clean = base32.toUpperCase().replace(/=+$/, "");
  for (let i = 0; i < clean.length; i++) {
    const val = alphabet.indexOf(clean[i]);
    if (val >= 0) bits += val.toString(2).padStart(5, "0");
  }
  let hex = "";
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    hex += parseInt(bits.substr(i, 4), 2).toString(16);
  }
  return hex.toLowerCase().slice(0, 40).padStart(40, "0");
}
function parseSizeToBytes(sizeStr) {
  if (!sizeStr) return 18e8;
  const match = sizeStr.match(/([\d\.]+)\s*(GB|MB|GiB|MiB)/i);
  if (!match) return 18e8;
  const val = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit.startsWith("G")) {
    return Math.floor(val * 1024 * 1024 * 1024);
  }
  return Math.floor(val * 1024 * 1024);
}
function isRussianRelease(text) {
  if (!text) return false;
  if (/[\u0400-\u04FF]/.test(text)) return true;
  if (/\b(rus|rutor|rutracker|kraken|mvo|avo|dub\s*rus|dublado\s*rus)\b/i.test(text)) return true;
  if (text.includes("\u{1F1F7}\u{1F1FA}")) return true;
  if (/\[rus\]|\(rus\)/i.test(text)) return true;
  return false;
}
function isPortugueseRelease(text, cleanSource) {
  if (!text) return false;
  const t = text.toLowerCase();
  if (cleanSource === "YTS HD" || cleanSource === "EZTV S\xE9ries" || cleanSource === "Nyaa Anime" || /\b(yts|yify|eztv|nyaa|nyaasi)\b/i.test(t)) {
    return false;
  }
  if (/\b(legendado|legendas|subpack|multisubs?)\b/i.test(t) && !/\b(dublado|dub\b|dual\b)\b/i.test(t)) {
    return false;
  }
  const isBrazilianTracker = cleanSource === "Brazuka / Comando" || cleanSource === "BluDV Filmes" || t.includes("comando") || t.includes("bludv") || t.includes("micoleaodublado") || t.includes("brazuka");
  const hasExplicitAudioPt = t.includes("dublado") || t.includes("audio dublado") || t.includes("\xE1udio dublado") || t.includes("dual \xE1udio") || t.includes("dual audio") || t.includes("pt-br") || t.includes("pt.br") || t.includes("ptbr") || t.includes("nacional") || /\b(dub|dual)\b/i.test(t);
  const hasForeignDual = /\b(ita|italian|italiano|spa|spanish|espanol|latino|french|vf2|vff|german|deutsch|hindi|tamil|telugu|polish|pol)\b/i.test(
    t
  );
  if (hasForeignDual && !t.includes("pt-br") && !t.includes("ptbr") && !t.includes("dublado") && !t.includes("portug") && !isBrazilianTracker) {
    return false;
  }
  if (isBrazilianTracker && (hasExplicitAudioPt || t.includes("\u{1F1E7}\u{1F1F7}") || t.includes("\u{1F1F5}\u{1F1F9}"))) {
    return true;
  }
  if (t.includes("dublado") || t.includes("pt-br") || t.includes("pt.br") || t.includes("ptbr") || t.includes("nacional") || t.includes("portugu\xEAs") || t.includes("portugues")) {
    return true;
  }
  return false;
}
function formatSourceLabel(sourceStr, fullText) {
  const low = (sourceStr + " " + fullText).toLowerCase();
  if (low.includes("comando") || low.includes("brazuka")) return "Brazuka / Comando";
  if (low.includes("bludv")) return "BluDV Filmes";
  if (low.includes("torrentgalaxy")) return "TorrentGalaxy";
  if (low.includes("yts")) return "YTS HD";
  if (low.includes("thepiratebay")) return "ThePirateBay";
  if (low.includes("1337x")) return "1337x P2P";
  if (low.includes("eztv")) return "EZTV S\xE9ries";
  if (low.includes("nyaa")) return "Nyaa Anime";
  return sourceStr || "Popoca P2P";
}
function computeStabilityScore(params) {
  const { seeds, sizeBytes, quality, isPtAudio, format, cleanSource, fullText, trackerPriority } = params;
  const sizeGB = Math.max(0.35, sizeBytes / (1024 * 1024 * 1024));
  let score = 0;
  if (seeds <= 0) {
    score -= 800;
  } else if (seeds === 1) {
    score -= 260;
  } else if (seeds < 4) {
    score -= 100;
  }
  const seedsPerGb = seeds / sizeGB;
  score += Math.min(620, seeds * 0.9 + seedsPerGb * 5.2);
  if (quality === "1080p") score += 200;
  else if (quality === "720p") score += 120;
  else if (quality === "4K") score -= 260;
  if (isPtAudio && trackerPriority !== "ultra-speed") {
    if (seeds >= 15) {
      score += trackerPriority === "pt-br-stability" ? 720 : 420;
    } else if (seeds >= 6) {
      score += trackerPriority === "pt-br-stability" ? 540 : 300;
    } else if (seeds >= 2) {
      score += trackerPriority === "pt-br-stability" ? 260 : 120;
    }
  } else if (isPtAudio && trackerPriority === "ultra-speed" && seeds >= 12) {
    score += 260;
  }
  if (cleanSource === "YTS HD" || cleanSource === "TorrentGalaxy" || cleanSource === "EZTV S\xE9ries") {
    score += 150;
  } else if ((cleanSource === "Brazuka / Comando" || cleanSource === "BluDV Filmes") && seeds >= 8) {
    score += trackerPriority === "pt-br-stability" ? 130 : 75;
  } else if (cleanSource === "1337x P2P" || cleanSource === "Nyaa Anime") {
    score += 95;
  }
  if (format === "WEB-DL") score += 85;
  if (/\.mp4\b/i.test(fullText) || cleanSource === "YTS HD") score += 180;
  if (/\b(x264|h\.?264|avc)\b/i.test(fullText)) score += 150;
  if (sizeGB >= 0.55 && sizeGB <= 3.5) score += 120;
  if (/(hevc|x265|h\.?265|10\s*-?bits?|av1)/i.test(fullText)) score -= 650;
  if (sizeGB > 4.2) score -= 220;
  if (/\bremux\b/i.test(fullText) || sizeGB > 6) score -= 420;
  return Math.round(score);
}
var IndexerService = class {
  constructor() {
    this.defaultPriority = "pt-br-stability";
  }
  getTrackerPriority() {
    return this.defaultPriority;
  }
  setTrackerPriority(mode) {
    if (TRACKER_PROFILES[mode]) {
      this.defaultPriority = mode;
    }
  }
  async findTorrents(queryOrOptions, yearArg, imdbIdArg, mediaTypeArg = "movie", seasonArg, episodeArg, trackerPriorityArg) {
    let query;
    let originalTitle;
    let year = yearArg;
    let imdbId = imdbIdArg;
    let mediaType = mediaTypeArg;
    let season = seasonArg;
    let episode = episodeArg;
    let trackerPriority = trackerPriorityArg || this.defaultPriority;
    if (typeof queryOrOptions === "object") {
      query = queryOrOptions.title;
      originalTitle = queryOrOptions.originalTitle;
      year = queryOrOptions.year;
      imdbId = queryOrOptions.imdbId;
      if (queryOrOptions.mediaType) mediaType = queryOrOptions.mediaType;
      season = queryOrOptions.season;
      episode = queryOrOptions.episode;
      if (queryOrOptions.trackerPriority) trackerPriority = queryOrOptions.trackerPriority;
    } else {
      query = queryOrOptions;
    }
    const searchTitleForFallback = (originalTitle || query || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9\s]/g, " ").trim();
    const releaseYear = year || "2026";
    let targetImdb = imdbId;
    if (!targetImdb && (query || searchTitleForFallback)) {
      try {
        const cleanQ = (searchTitleForFallback || query).trim().toLowerCase();
        const firstChar = cleanQ.replace(/[^a-z0-9]/gi, "").charAt(0) || "x";
        const qEncoded = encodeURIComponent(cleanQ);
        const imdbSugRes = await fetch(`https://v3.sg.media-imdb.com/suggestion/${firstChar}/${qEncoded}.json`, {
          headers: { "Accept-Language": "pt-BR,pt;q=0.9" },
          signal: AbortSignal.timeout(3e3)
        });
        if (imdbSugRes.ok) {
          const sugData = await imdbSugRes.json();
          const list = Array.isArray(sugData.d) ? sugData.d : [];
          const wantSeries = mediaType === "tv" || mediaType === "anime";
          const preferredMatch = list.find(
            (d) => typeof d.id === "string" && d.id.startsWith("tt") && (wantSeries ? d.qid === "tvSeries" || d.qid === "tvMiniSeries" : d.qid === "movie" || d.qid === "feature")
          );
          const firstValid = preferredMatch || list.find((d) => typeof d.id === "string" && d.id.startsWith("tt"));
          if (firstValid) {
            targetImdb = firstValid.id;
          }
        }
      } catch {
      }
      if (!targetImdb && searchTitleForFallback) {
        try {
          const cinemetaType = mediaType === "movie" ? "movie" : "series";
          const cinemetaUrl = `https://v3-cinemeta.strem.io/catalog/${cinemetaType}/top/search=${encodeURIComponent(searchTitleForFallback)}.json`;
          const metaRes = await fetch(cinemetaUrl, { signal: AbortSignal.timeout(3200) });
          if (metaRes.ok) {
            const metaData = await metaRes.json();
            if (metaData.metas && metaData.metas.length > 0) {
              targetImdb = metaData.metas[0].id;
            }
          }
        } catch (err) {
          console.warn("[IndexerService] Aviso na busca Cinemeta:", err.message);
        }
      }
    }
    const rawStreams = [];
    if (targetImdb) {
      const providersList = trackerPriority === "ultra-speed" ? "yts,torrentgalaxy,comando,bludv,micoleaodublado,1337x,eztv,nyaasi,thepiratebay" : "comando,bludv,micoleaodublado,yts,torrentgalaxy,1337x,eztv,nyaasi,thepiratebay";
      const streamPath = `${mediaType === "movie" ? "movie" : "series"}/${targetImdb}${mediaType === "movie" ? "" : `:${season || 1}:${episode || 1}`}.json`;
      const endpoints = [
        `https://torrentio.strem.fun/providers=${providersList}|language=portuguese/stream/${streamPath}`,
        `https://torrentio.strem.fun/providers=${providersList}/stream/${streamPath}`
      ];
      const settled = await Promise.allSettled(
        endpoints.map(
          (ep) => fetch(ep, { signal: AbortSignal.timeout(4800) }).then((r) => r.ok ? r.json() : null)
        )
      );
      for (const res of settled) {
        if (res.status === "fulfilled" && res.value?.streams?.length) {
          rawStreams.push(...res.value.streams);
        }
      }
    }
    const seenHashes = /* @__PURE__ */ new Set();
    const parsedItems = [];
    for (let idx = 0; idx < rawStreams.length; idx++) {
      const st = rawStreams[idx];
      const fullText = `${st.name || ""} ${st.title || ""}`;
      if (isRussianRelease(fullText)) {
        continue;
      }
      if (/\b(hdcam|camrip|telesync|hdts)\b/i.test(fullText) && rawStreams.length > 6) {
        continue;
      }
      const hash = sanitizeInfoHash(st.infoHash || "");
      if (!hash || hash.length !== 40 || seenHashes.has(hash)) {
        continue;
      }
      seenHashes.add(hash);
      const seedMatch = fullText.match(/\u{1F464}\s*(\d+)/u);
      const seeds = seedMatch ? parseInt(seedMatch[1], 10) : 0;
      const sizeMatch = fullText.match(/\u{1F4BE}\s*([\d\.]+\s*(?:GB|MB|GiB|MiB))/iu);
      const sizeFormatted = sizeMatch ? sizeMatch[1].trim() : "1.65 GB";
      const sizeBytes = parseSizeToBytes(sizeFormatted);
      let quality = "1080p";
      if (/4k|2160p|uhd/i.test(fullText)) quality = "4K";
      else if (/720p/i.test(fullText)) quality = "720p";
      let format = "WEB-DL";
      if (/bluray|blu-ray|bdrip|brrip|remux/i.test(fullText)) {
        format = "Bluray";
      } else if (/web-dl|webrip|web/i.test(fullText)) {
        format = "WEB-DL";
      }
      const lines = (st.title || "").split("\n");
      const filename = lines[0] || `${query || searchTitleForFallback} (${releaseYear}) [${quality} ${format}]`;
      const sourceMatch = fullText.match(/\u{2699}\uFE0F?\s*([^\n\r]+)/u);
      const rawSource = sourceMatch ? sourceMatch[1].trim() : "Popoca P2P";
      const cleanSource = formatSourceLabel(rawSource, fullText);
      const isPtAudio = isPortugueseRelease(fullText, cleanSource);
      const stabilityScore = computeStabilityScore({
        seeds,
        sizeBytes,
        quality,
        isPtAudio,
        format,
        cleanSource,
        fullText,
        trackerPriority
      });
      parsedItems.push({
        id: `stream-${hash.slice(0, 10)}-${idx}`,
        title: filename,
        magnetUri: buildMagnet(hash, filename, trackerPriority),
        infoHash: hash,
        quality,
        format,
        seeds,
        peers: Math.max(1, Math.floor(seeds * 0.28)),
        sizeBytes,
        sizeFormatted,
        isPortugueseAudio: isPtAudio,
        source: cleanSource,
        stabilityScore,
        trackerPriority,
        fileIdx: typeof st.fileIdx === "number" ? st.fileIdx : void 0
      });
    }
    const hasHealthy = parsedItems.some((i) => i.seeds >= 3);
    const activeItems = hasHealthy ? parsedItems.filter((i) => i.seeds >= 1) : parsedItems;
    const sortWithPtPriority = (a, b) => {
      if (trackerPriority === "pt-br-stability") {
        const isPtViable = (item) => {
          if (!item.isPortugueseAudio) return 0;
          const minViableSeeds = item.sizeBytes > 4.5 * 1024 * 1024 * 1024 ? 8 : 5;
          return item.seeds >= minViableSeeds ? 1 : 0;
        };
        const aPtHealthy = isPtViable(a);
        const bPtHealthy = isPtViable(b);
        if (aPtHealthy !== bPtHealthy) return bPtHealthy - aPtHealthy;
      }
      return b.stabilityScore - a.stabilityScore || b.seeds - a.seeds;
    };
    activeItems.sort(sortWithPtPriority);
    const selected = [];
    const selectedHashes = /* @__PURE__ */ new Set();
    const addCandidate = (item) => {
      if (!selectedHashes.has(item.infoHash)) {
        selectedHashes.add(item.infoHash);
        selected.push(item);
      }
    };
    activeItems.slice(0, 12).forEach(addCandidate);
    for (const q of ["1080p", "720p", "4K"]) {
      activeItems.filter((t) => t.quality === q && t.isPortugueseAudio).slice(0, 3).forEach(addCandidate);
      activeItems.filter((t) => t.quality === q && !t.isPortugueseAudio).slice(0, 3).forEach(addCandidate);
    }
    return selected.sort(sortWithPtPriority);
  }
};
function normalizeQuality(raw) {
  if (!raw) return "1080p";
  const low = raw.trim().toLowerCase();
  if (low === "4k" || low === "2160p" || low === "uhd") return "4K";
  if (low === "720p" || low === "hd") return "720p";
  return "1080p";
}
var QUALITY_RANK = {
  "4K": 3,
  "1080p": 2,
  "720p": 1
};
function selectQualityCappedCandidates(torrents, preferredQuality, preferPortugueseAudio = true) {
  const requestedQuality = normalizeQuality(preferredQuality);
  const maxRank = QUALITY_RANK[requestedQuality];
  const valid = torrents.filter((t) => Boolean(t.magnetUri));
  const capped = valid.filter((t) => QUALITY_RANK[t.quality] <= maxRank);
  const pool = capped.length > 0 ? capped : valid;
  const sortByLangAndSeedsDesc = (a, b) => {
    const aLangMatch = preferPortugueseAudio ? a.isPortugueseAudio ? 1 : 0 : !a.isPortugueseAudio ? 1 : 0;
    const bLangMatch = preferPortugueseAudio ? b.isPortugueseAudio ? 1 : 0 : !b.isPortugueseAudio ? 1 : 0;
    if (aLangMatch !== bLangMatch) return bLangMatch - aLangMatch;
    return b.seeds - a.seeds || b.stabilityScore - a.stabilityScore;
  };
  const sortBySeedsDesc = (a, b) => b.seeds - a.seeds || b.stabilityScore - a.stabilityScore;
  const exactQuality = pool.filter((t) => t.quality === requestedQuality).sort(sortByLangAndSeedsDesc);
  const lowerOrder = requestedQuality === "4K" ? ["1080p", "720p"] : requestedQuality === "1080p" ? ["720p"] : [];
  let fallbackQuality = null;
  let fallbackCandidates = [];
  for (const lq of lowerOrder) {
    const matches = pool.filter((t) => t.quality === lq).sort(sortByLangAndSeedsDesc);
    if (matches.length > 0) {
      fallbackQuality = lq;
      fallbackCandidates = matches;
      break;
    }
  }
  const primaryCandidates = exactQuality.length > 0 ? exactQuality : fallbackCandidates;
  let hybridCandidate = null;
  if (preferPortugueseAudio && requestedQuality !== "720p") {
    const ptExact = capped.filter((t) => t.isPortugueseAudio && t.quality === requestedQuality);
    const pt720 = capped.filter((t) => t.isPortugueseAudio && t.quality === "720p" && t.seeds >= 1).sort(sortBySeedsDesc);
    const enHigh = capped.filter((t) => !t.isPortugueseAudio && t.quality === requestedQuality && t.seeds >= 2).sort((a, b) => {
      const aWebDl = a.format === "WEB-DL" ? 1 : 0;
      const bWebDl = b.format === "WEB-DL" ? 1 : 0;
      if (aWebDl !== bWebDl) return bWebDl - aWebDl;
      return b.seeds - a.seeds;
    });
    if (ptExact.length === 0 && pt720.length > 0 && enHigh.length > 0) {
      const preferredAudio = pt720.find((a) => a.format === enHigh[0].format) || pt720[0];
      hybridCandidate = {
        videoTorrent: enHigh[0],
        audioTorrent: preferredAudio
      };
    }
  }
  return {
    requestedQuality,
    primaryCandidates,
    fallbackCandidates: exactQuality.length > 0 ? fallbackCandidates : [],
    fallbackQuality: exactQuality.length > 0 ? fallbackQuality : null,
    hybridCandidate
  };
}
var indexerService = new IndexerService();

// server/torrentEngine.ts
import os from "os";
import path from "path";
import http from "http";
import fs from "fs";
import crypto from "crypto";
import { createRequire as createRequire2 } from "module";
import torrentStream from "torrent-stream";

// server/transcoder.ts
import ffmpeg from "fluent-ffmpeg";
import { spawn } from "child_process";
import { createRequire } from "module";
var require2 = createRequire(import.meta.url);
var resolvedFfmpegPath = "ffmpeg";
try {
  const ffmpegInstaller = require2("@ffmpeg-installer/ffmpeg");
  if (ffmpegInstaller?.path) {
    resolvedFfmpegPath = ffmpegInstaller.path;
    ffmpeg.setFfmpegPath(resolvedFfmpegPath);
    console.log(`[Transcoder] FFmpeg nativo pronto: ${resolvedFfmpegPath}`);
  }
} catch {
  console.warn("[Transcoder] @ffmpeg-installer/ffmpeg indispon\xEDvel; usando ffmpeg do PATH.");
}
var TranscoderQueueManager = class {
  constructor() {
    this.activeJobs = /* @__PURE__ */ new Map();
    this.queue = [];
    this.maxConcurrent = 5;
    this.jobCounter = 0;
  }
  isWebNative(fileName) {
    const ext = fileName.toLowerCase().split(".").pop() || "";
    return ["mp4", "m4v", "webm"].includes(ext);
  }
  /**
   * Inspeciona os primeiros ~128KB do contêiner em memória (~40ms) para identificar
   * todas as trilhas de áudio (ex: Português vs Inglês em Dual Áudio) e se o vídeo é HEVC/10-bit.
   */
  probeBufferStreams(headerBuffer) {
    return new Promise((resolve) => {
      if (!headerBuffer || headerBuffer.length < 4096) {
        resolve(null);
        return;
      }
      let settled = false;
      const done = (val) => {
        if (settled) return;
        settled = true;
        resolve(val);
      };
      try {
        const proc = spawn(resolvedFfmpegPath, [
          "-hide_banner",
          "-probesize",
          String(Math.min(headerBuffer.length, 262144)),
          "-analyzeduration",
          "0",
          "-i",
          "pipe:0"
        ]);
        let stderr = "";
        const safetyTimer = setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {
          }
          done(null);
        }, 1600);
        proc.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        proc.on("error", () => {
          clearTimeout(safetyTimer);
          done(null);
        });
        proc.on("close", () => {
          clearTimeout(safetyTimer);
          done(this.parseFfmpegStderrProbe(stderr));
        });
        proc.stdin.on("error", () => {
        });
        proc.stdin.end(headerBuffer);
      } catch {
        done(null);
      }
    });
  }
  parseFfmpegStderrProbe(stderr) {
    if (!stderr) return null;
    const lines = stderr.split(/\r?\n/);
    let videoCodec = "h264";
    let is10Bit = false;
    const audioTracks = [];
    let currentAudioTrack = null;
    for (const line of lines) {
      const streamMatch = line.match(
        /Stream #0:\d+(?:\(([a-zA-Z0-9_-]+)\))?(?:\[[^\]]+\])?:\s*(Video|Audio|Subtitle):\s*([a-zA-Z0-9_]+)(.*)/
      );
      if (streamMatch) {
        const lang = (streamMatch[1] || "und").toLowerCase();
        const kind = streamMatch[2];
        const codec = (streamMatch[3] || "").toLowerCase();
        const rest = streamMatch[4] || "";
        if (kind === "Video") {
          currentAudioTrack = null;
          videoCodec = codec;
          if (/10le|10be|10-bit|p010/i.test(rest)) {
            is10Bit = true;
          }
        } else if (kind === "Audio") {
          const channels = /5\.1|6 channels/i.test(rest) ? 6 : /7\.1|8 channels/i.test(rest) ? 8 : /mono|1 channels/i.test(rest) ? 1 : 2;
          currentAudioTrack = {
            aIndex: audioTracks.length,
            lang,
            title: "",
            codec,
            channels
          };
          audioTracks.push(currentAudioTrack);
        } else {
          currentAudioTrack = null;
        }
        continue;
      }
      if (currentAudioTrack) {
        const titleMatch = line.match(/^\s*title\s*:\s*(.+)$/i);
        if (titleMatch) {
          currentAudioTrack.title = titleMatch[1].trim();
        }
      }
    }
    const hasPortugueseAudioTrack = audioTracks.some(
      (t) => /^(por|pt|pt-br|pob|pb)$/i.test(t.lang) || /(portug|dublado|\bdub\b|pt-br|ptbr|brasil|nacional)/i.test(t.title)
    );
    return { videoCodec, is10Bit, audioTracks, hasPortugueseAudioTrack };
  }
  resolveAudioSelection(options) {
    const info = options.probedInfo;
    const tracks = info?.audioTracks || [];
    if (typeof options.audioTrackIndex === "number" && options.audioTrackIndex >= 0) {
      const clamped = tracks.length > 0 ? Math.min(options.audioTrackIndex, tracks.length - 1) : options.audioTrackIndex;
      const found = tracks[clamped];
      return {
        audioIndex: clamped,
        canCopyAudio: Boolean(found && found.codec === "aac" && found.channels <= 2 && !options.seekSeconds)
      };
    }
    if (tracks.length === 0) {
      return { audioIndex: 0, canCopyAudio: false };
    }
    const preferPt = options.preferPortugueseAudio !== false;
    let chosen = tracks[0];
    if (preferPt) {
      const ptMatch = tracks.find(
        (t) => /^(por|pt|pt-br|pob|pb)$/i.test(t.lang) || /(portug|dublado|\bdub\b|pt-br|ptbr|brasil|nacional)/i.test(t.title)
      );
      if (ptMatch) {
        chosen = ptMatch;
      } else if (tracks.length >= 2 && /^(eng|en|jpn|ja)$/i.test(tracks[0].lang) && tracks[1].lang === "und" && /dublado|\bdual\b|pt-br/i.test(options.sourceFileName || "")) {
        chosen = tracks[1];
      }
    } else {
      const origMatch = tracks.find(
        (t) => /^(eng|en|jpn|ja|kor|ko|spa|fra|ita|deu)$/i.test(t.lang) || /(original|english|ingl[eê]s|japanese|japon[eê]s)/i.test(t.title)
      );
      if (origMatch) chosen = origMatch;
    }
    return {
      audioIndex: chosen.aIndex,
      canCopyAudio: Boolean(chosen.codec === "aac" && chosen.channels <= 2 && !options.seekSeconds)
    };
  }
  transcodeStream(inputSource, outputDestination, options = {}) {
    this.jobCounter += 1;
    const jobId = options.jobId || `transcode-${this.jobCounter}-${Date.now()}`;
    const priority = options.priority !== void 0 ? options.priority : 1;
    const job = {
      id: jobId,
      priority,
      createdAt: Date.now(),
      inputSource,
      outputDestination,
      options,
      isStarted: false,
      isDestroyed: false
    };
    this.queue.push(job);
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.createdAt - b.createdAt;
    });
    this.processQueue();
    return {
      id: jobId,
      cancel: () => this.cancelJob(jobId),
      getCommand: () => job.command
    };
  }
  processQueue() {
    while (this.activeJobs.size < this.maxConcurrent && this.queue.length > 0) {
      const nextJob = this.queue.shift();
      if (!nextJob || nextJob.isDestroyed) continue;
      this.startJob(nextJob);
    }
  }
  startJob(job) {
    job.isStarted = true;
    this.activeJobs.set(job.id, job);
    const probed = job.options.probedInfo;
    const probedNeedsReencode = probed ? probed.videoCodec !== "h264" || probed.is10Bit : /(hevc|x265|h\.?265|10\s*-?bits?|av1)/i.test(job.options.sourceFileName || "");
    const isHttpInput = typeof job.inputSource === "string";
    const seekSec = job.options.seekSeconds && job.options.seekSeconds > 0 ? job.options.seekSeconds : 0;
    const inOpts = [];
    if (seekSec > 0) {
      inOpts.push("-noaccurate_seek", "-ss", seekSec.toFixed(2));
    }
    inOpts.push("-fflags", "+discardcorrupt+nobuffer+genpts");
    if (isHttpInput) {
      inOpts.push("-seekable", "1", "-reconnect", "1", "-reconnect_streamed", "1");
    }
    if (seekSec > 0) {
      inOpts.push("-probesize", "5242880", "-analyzeduration", "5000000");
    } else {
      inOpts.push("-probesize", "2097152", "-analyzeduration", "2000000");
    }
    const command = ffmpeg(job.inputSource);
    command.inputOptions(inOpts);
    job.command = command;
    const { audioIndex, canCopyAudio } = this.resolveAudioSelection(job.options);
    if (job.options.audioOnly) {
      command.outputOptions([`-map 0:a:${audioIndex}?`, "-sn", "-dn"]).noVideo().audioCodec("aac").audioBitrate("128k").audioChannels(2).format("adts");
    } else if (probedNeedsReencode) {
      command.outputOptions([
        "-map 0:v:0",
        `-map 0:a:${audioIndex}?`,
        "-sn",
        "-dn",
        "-disposition:a:0 default",
        "-preset ultrafast",
        "-tune zerolatency",
        "-crf 24",
        "-pix_fmt yuv420p",
        "-af aresample=async=1",
        "-avoid_negative_ts make_zero",
        "-max_muxing_queue_size 2048",
        "-frag_duration 400000",
        "-movflags frag_keyframe+empty_moov+default_base_moof"
      ]).videoCodec("libx264").audioCodec("aac").audioBitrate("160k").audioChannels(2).format("mp4");
    } else {
      const outOpts = [
        "-map 0:v:0",
        `-map 0:a:${audioIndex}?`,
        "-sn",
        "-dn",
        "-disposition:a:0 default",
        "-avoid_negative_ts make_zero",
        "-max_muxing_queue_size 2048",
        "-frag_duration 400000",
        "-movflags frag_keyframe+empty_moov+default_base_moof"
      ];
      if (!canCopyAudio) {
        outOpts.push("-af aresample=async=1");
      }
      command.outputOptions(outOpts).videoCodec("copy").audioCodec(canCopyAudio ? "copy" : "aac");
      if (!canCopyAudio) {
        command.audioBitrate("192k").audioChannels(2);
      }
      command.format("mp4");
    }
    command.on("start", (cmdline) => {
      console.log(
        `[Transcoder FFmpeg] Job ${job.id} [audio=#${audioIndex}, seek=${seekSec}s, copyV=${!probedNeedsReencode}]: ${cmdline.slice(0, 92)}...`
      );
    });
    command.on("error", (err) => {
      const msg = err?.message || "";
      if (!msg.includes("SIGKILL") && !msg.includes("Output stream closed") && !msg.includes("Premature close") && !msg.includes("pipe:0: Invalid data")) {
        console.warn(`[Transcoder FFmpeg] Aviso no Job ${job.id}:`, msg);
      }
      this.finalizeJob(job.id);
    });
    command.on("end", () => {
      this.finalizeJob(job.id);
    });
    command.pipe(job.outputDestination, { end: true });
    job.outputDestination.on("close", () => {
      this.cancelJob(job.id);
    });
    job.outputDestination.on("error", () => {
      this.cancelJob(job.id);
    });
  }
  /**
   * FASE 3: Muxing Hibrido em Tempo Real (Video 4K/1080p EN + Audio 720p PT-BR)
   * Mapeia o video do Stream 0 (-map 0:v:0) com -c:v copy (zero custo de CPU)
   * e o audio do Stream 1 (-map 1:a:0) convertido para AAC estereo 192k (-c:a aac -b:a 192k -ac 2)
   * em container Fragmented MP4 (-f mp4 -movflags frag_keyframe+empty_moov+default_base_moof).
   */
  transcodeHybridStream(videoInput, audioInput, outputDestination, options = {}) {
    this.jobCounter += 1;
    const jobId = `hybrid-${this.jobCounter}-${Date.now()}`;
    const seekSec = options.seekSeconds && options.seekSeconds > 0 ? options.seekSeconds : 0;
    const delayMs = options.audioDelayMs ? Math.round(options.audioDelayMs) : 0;
    const buildInputOpts = (src) => {
      const opts = [];
      if (seekSec > 0) {
        opts.push("-noaccurate_seek", "-ss", seekSec.toFixed(2));
      }
      opts.push("-fflags", "+discardcorrupt+nobuffer+genpts");
      if (typeof src === "string") {
        opts.push("-seekable", "1", "-reconnect", "1", "-reconnect_streamed", "1");
      }
      if (seekSec > 0) {
        opts.push("-probesize", "5242880", "-analyzeduration", "5000000");
      } else {
        opts.push("-probesize", "2097152", "-analyzeduration", "2000000");
      }
      return opts;
    };
    const command = ffmpeg();
    command.input(videoInput).inputOptions(buildInputOpts(videoInput));
    command.input(audioInput).inputOptions(buildInputOpts(audioInput));
    const audioFilters = ["aresample=async=1"];
    if (delayMs > 0) {
      audioFilters.push(`adelay=${delayMs}|${delayMs}`);
    }
    command.outputOptions([
      "-map 0:v:0",
      "-map 1:a:0",
      "-sn",
      "-dn",
      "-c:v copy",
      "-c:a aac",
      "-b:a 192k",
      "-ac 2",
      `-af ${audioFilters.join(",")}`,
      "-avoid_negative_ts make_zero",
      "-max_muxing_queue_size 2048",
      "-frag_duration 400000",
      "-movflags frag_keyframe+empty_moov+default_base_moof"
    ]).format("mp4");
    let isCleaned = false;
    const cleanupHybrid = () => {
      if (isCleaned) return;
      isCleaned = true;
      try {
        command.kill("SIGKILL");
      } catch {
      }
      try {
        if (typeof videoInput !== "string") videoInput.destroy();
      } catch {
      }
      try {
        if (typeof audioInput !== "string") audioInput.destroy();
      } catch {
      }
      options.onCancel?.();
    };
    command.on("start", (cmdline) => {
      console.log(`[Transcoder Hybrid Mux] Job ${jobId} iniciado: ${cmdline.slice(0, 110)}...`);
    });
    command.on("error", (err) => {
      const msg = err?.message || "";
      if (!msg.includes("SIGKILL") && !msg.includes("Output stream closed") && !msg.includes("Premature close")) {
        console.warn(`[Transcoder Hybrid Mux] Aviso no Job ${jobId}:`, msg);
      }
      cleanupHybrid();
    });
    command.on("end", () => {
      cleanupHybrid();
    });
    outputDestination.on("close", cleanupHybrid);
    outputDestination.on("error", cleanupHybrid);
    command.pipe(outputDestination, { end: true });
    return {
      id: jobId,
      cancel: cleanupHybrid,
      command
    };
  }
  cancelJob(jobId) {
    const queueIdx = this.queue.findIndex((j) => j.id === jobId);
    if (queueIdx !== -1) {
      const [removed] = this.queue.splice(queueIdx, 1);
      removed.isDestroyed = true;
      try {
        if (typeof removed.inputSource !== "string") {
          removed.inputSource.destroy();
        }
      } catch {
      }
      removed.options.onCancel?.();
      return;
    }
    const active = this.activeJobs.get(jobId);
    if (active) {
      active.isDestroyed = true;
      try {
        if (active.command) {
          active.command.kill("SIGKILL");
        }
      } catch {
      }
      try {
        if (typeof active.inputSource !== "string") {
          active.inputSource.destroy();
        }
      } catch {
      }
      this.finalizeJob(jobId);
    }
  }
  finalizeJob(jobId) {
    const job = this.activeJobs.get(jobId);
    if (!job) return;
    this.activeJobs.delete(jobId);
    job.options.onCancel?.();
    this.processQueue();
  }
  getQueueStatus() {
    return {
      activeCount: this.activeJobs.size,
      queuedCount: this.queue.length
    };
  }
};
var transcoder = new TranscoderQueueManager();

// server/torrentEngine.ts
var require3 = createRequire2(import.meta.url);
var parseTorrentLib = require3("parse-torrent");
var bncodeLib = require3("bncode");
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = "32";
}
var CACHE_BASE_DIR = process.env.CACHE_DIR || path.join(os.tmpdir(), "popoca-cache");
var MAX_CACHE_BYTES = Number(process.env.MAX_CACHE_BYTES) || 384 * 1024 * 1024;
var CACHE_HIGH_WATERMARK = Math.floor(MAX_CACHE_BYTES * 0.8);
var CACHE_LOW_WATERMARK = Math.floor(MAX_CACHE_BYTES * 0.5);
var INACTIVE_EVICT_MS = 15 * 60 * 1e3;
var MAX_ACTIVE_ENGINES = Number(process.env.MAX_ACTIVE_TORRENTS) || 4;
var LOW_SPEED_THRESHOLD_BYTES_SEC = 140 * 1024;
var AUTO_RETRY_COOLDOWN_MS = 14e3;
var HEALTH_CHECK_TIMEOUT_MS = 5e3;
function getDirectorySize(dir) {
  let size = 0;
  let newest = 0;
  try {
    if (!fs.existsSync(dir)) return { size: 0, newest: 0 };
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          const sub = getDirectorySize(fullPath);
          size += sub.size;
          newest = Math.max(newest, sub.newest);
        } else {
          const st = fs.statSync(fullPath);
          const actualAllocated = typeof st.blocks === "number" && st.blocks > 0 ? Math.min(st.size, st.blocks * 512) : st.size;
          size += actualAllocated;
          newest = Math.max(newest, st.mtimeMs);
        }
      } catch {
      }
    }
  } catch {
  }
  return { size, newest };
}
function isValidBencodedTorrent(buf) {
  if (!buf || buf.length < 250) return false;
  if (buf[0] !== 100) return false;
  const headStr = buf.subarray(0, 64).toString("utf8").toLowerCase();
  if (headStr.includes("<html") || headStr.includes("<!doctype") || headStr.includes("cloudflare")) {
    return false;
  }
  return buf.includes(Buffer.from("4:info"));
}
function generatePieceMap(bitfield, totalPieces, numBuckets = 60) {
  if (!bitfield || typeof bitfield.get !== "function" || totalPieces <= 0) {
    return [];
  }
  const buckets = new Array(numBuckets).fill(0);
  const bucketSize = totalPieces / numBuckets;
  for (let b = 0; b < numBuckets; b++) {
    const startP = Math.floor(b * bucketSize);
    const endP = Math.min(totalPieces, Math.floor((b + 1) * bucketSize));
    let count = 0;
    const totalInBucket = Math.max(1, endP - startP);
    for (let p = startP; p < endP; p++) {
      if (bitfield.get(p)) {
        count++;
      }
    }
    buckets[b] = Math.round(count / totalInBucket * 100);
  }
  return buckets;
}
function parseTorrentBuffer(buf) {
  if (!isValidBencodedTorrent(buf)) {
    return { valid: false, error: "Arquivo .torrent inv\xE1lido ou corrompido." };
  }
  try {
    let parseElement2 = function() {
      if (idx >= buf.length) return false;
      const b = buf[idx];
      if (b === 105) {
        idx++;
        while (idx < buf.length && buf[idx] !== 101) idx++;
        if (idx < buf.length) idx++;
        return true;
      }
      if (b >= 48 && b <= 57) {
        let len = 0;
        while (idx < buf.length && buf[idx] >= 48 && buf[idx] <= 57) {
          len = len * 10 + (buf[idx] - 48);
          idx++;
        }
        if (idx < buf.length && buf[idx] === 58) {
          idx++;
          idx += len;
          return idx <= buf.length;
        }
        return false;
      }
      if (b === 108) {
        idx++;
        while (idx < buf.length && buf[idx] !== 101) {
          if (!parseElement2()) return false;
        }
        if (idx < buf.length) idx++;
        return true;
      }
      if (b === 100) {
        idx++;
        while (idx < buf.length && buf[idx] !== 101) {
          if (!parseElement2()) return false;
          if (!parseElement2()) return false;
        }
        if (idx < buf.length) idx++;
        return true;
      }
      return false;
    };
    var parseElement = parseElement2;
    const infoKey = Buffer.from("4:info");
    const infoKeyIdx = buf.indexOf(infoKey);
    if (infoKeyIdx === -1) {
      return { valid: false, error: "Chave info n\xE3o encontrada no arquivo .torrent." };
    }
    const start = infoKeyIdx + infoKey.length;
    if (buf[start] !== 100) {
      return { valid: false, error: "Dicion\xE1rio info inv\xE1lido." };
    }
    let idx = start;
    const ok = parseElement2();
    const end = idx;
    if (!ok || end <= start) {
      return { valid: false, error: "Estrutura bencode do dicion\xE1rio info inv\xE1lida." };
    }
    const infoBuf = buf.subarray(start, end);
    const infoHash = crypto.createHash("sha1").update(infoBuf).digest("hex").toLowerCase();
    let name = "V\xEDdeo Popoca";
    const nameKey = Buffer.from("4:name");
    const nameKeyIdx = infoBuf.indexOf(nameKey);
    if (nameKeyIdx !== -1) {
      let nIdx = nameKeyIdx + nameKey.length;
      let strLen = 0;
      while (nIdx < infoBuf.length && infoBuf[nIdx] >= 48 && infoBuf[nIdx] <= 57) {
        strLen = strLen * 10 + (infoBuf[nIdx] - 48);
        nIdx++;
      }
      if (nIdx < infoBuf.length && infoBuf[nIdx] === 58 && strLen > 0 && strLen < 500) {
        nIdx++;
        if (nIdx + strLen <= infoBuf.length) {
          name = infoBuf.subarray(nIdx, nIdx + strLen).toString("utf8");
        }
      }
    }
    const magnetUri = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}`;
    return {
      valid: true,
      infoHash,
      name,
      magnetUri
    };
  } catch (err) {
    return { valid: false, error: err?.message || "Erro ao analisar arquivo .torrent" };
  }
}
function stripEmbeddedTrackersFromTorrentBuffer(buf) {
  try {
    const parsed = parseTorrentLib(buf);
    if (parsed && parsed.infoBuffer) {
      const cleanInfo = bncodeLib.decode(parsed.infoBuffer);
      return bncodeLib.encode({
        info: cleanInfo,
        "announce-list": []
      });
    }
  } catch {
  }
  return null;
}
async function fetchTorrentBuffer(hash) {
  const cleanHash = hash.toUpperCase();
  const urls = [
    `https://itorrents.org/torrent/${cleanHash}.torrent`,
    `https://btcache.me/torrent/${cleanHash}`,
    `https://torrage.info/torrent.php?h=${cleanHash}`
  ];
  const fetchers = urls.map(async (url) => {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(1800)
    });
    if (res.ok) {
      const ab = await res.arrayBuffer();
      const buf = Buffer.from(ab);
      if (isValidBencodedTorrent(buf)) {
        const cleaned = stripEmbeddedTrackersFromTorrentBuffer(buf);
        if (cleaned) return cleaned;
      }
    }
    throw new Error("Mirror sem bencode v\xE1lido: " + url);
  });
  try {
    return await Promise.any(fetchers);
  } catch {
    return null;
  }
}
function parseHttpRange(rangeHeader, fileSize) {
  if (!rangeHeader || typeof rangeHeader !== "string") return null;
  const match = rangeHeader.trim().match(/^bytes=(.+)$/i);
  if (!match) return null;
  const firstRangeToken = match[1].split(",")[0].trim();
  const dashIndex = firstRangeToken.indexOf("-");
  if (dashIndex === -1) return "unsatisfiable";
  const startStr = firstRangeToken.slice(0, dashIndex).trim();
  const endStr = firstRangeToken.slice(dashIndex + 1).trim();
  if (startStr === "") {
    if (endStr === "") return "unsatisfiable";
    const suffixLength = parseInt(endStr, 10);
    if (isNaN(suffixLength) || suffixLength <= 0) return "unsatisfiable";
    const start2 = Math.max(0, fileSize - suffixLength);
    const end2 = fileSize - 1;
    if (start2 >= fileSize || end2 < start2) return "unsatisfiable";
    return { start: start2, end: end2 };
  }
  const start = parseInt(startStr, 10);
  if (isNaN(start) || start < 0 || start >= fileSize) return "unsatisfiable";
  let end = fileSize - 1;
  if (endStr !== "") {
    const parsedEnd = parseInt(endStr, 10);
    if (isNaN(parsedEnd) || parsedEnd < start) return "unsatisfiable";
    end = Math.min(parsedEnd, fileSize - 1);
  }
  return { start, end };
}
function extractHash(magnetOrHash) {
  const match = magnetOrHash.match(/btih:([a-zA-Z0-9]+)/i) || magnetOrHash.match(/^([a-fA-F0-9]{40})$/);
  return (match ? match[1] : magnetOrHash).toLowerCase();
}
var TorrentEngine = class {
  constructor() {
    this.enginesMap = /* @__PURE__ */ new Map();
    this.pendingEnginesMap = /* @__PURE__ */ new Map();
    this.runtimeMetaMap = /* @__PURE__ */ new Map();
    this.cleanupTimers = /* @__PURE__ */ new Map();
    this.activeStreamsCount = /* @__PURE__ */ new Map();
    this.activeReadStreamsMap = /* @__PURE__ */ new Map();
    this.mediaProbeCache = /* @__PURE__ */ new Map();
    this.pendingProbeMap = /* @__PURE__ */ new Map();
    this.activeClientTranscodeMap = /* @__PURE__ */ new Map();
    this.activeClientStreamByIp = /* @__PURE__ */ new Map();
    this.wireOptimizerIntervals = /* @__PURE__ */ new Map();
    this.defaultTrackerPriority = "pt-br-stability";
    this.portCursor = Math.floor(Math.random() * 8e3);
    this.sharedDht = null;
    this.localRawServer = null;
    this.localRawPort = 0;
    this.initSharedDht();
    this.initLocalRawServer();
    this.startPeriodicSweeper();
    this.pruneDiskCache();
  }
  initSharedDht() {
    try {
      const DHT = require3("bittorrent-dht/client");
      if (typeof DHT === "function") {
        const dht = new DHT();
        if (typeof dht.setMaxListeners === "function") {
          dht.setMaxListeners(100);
        }
        dht.on("error", () => {
        });
        dht.on("peer", (peer, infoHash) => {
          try {
            if (!peer || !peer.host || !peer.port || !infoHash) return;
            const h = Buffer.isBuffer(infoHash) ? infoHash.toString("hex").toLowerCase() : String(infoHash).toLowerCase();
            const eng = this.enginesMap.get(h);
            if (eng && typeof eng.connect === "function") {
              eng.connect(`${peer.host}:${peer.port}`);
            }
          } catch {
          }
        });
        dht.listen(0);
        this.sharedDht = dht;
      }
    } catch {
    }
  }
  /**
   * Servidor HTTP 206 interno (loopback 127.0.0.1) que permite ao FFmpeg fazer seek instantâneo (-ss)
   * em arquivos .mkv usando o índice Matroska Cues sem precisar ler desde o minuto 00:00!
   */
  initLocalRawServer() {
    try {
      const srv = http.createServer((req, res) => {
        try {
          const urlPath = req.url || "";
          const match = urlPath.match(/^\/raw\/([a-f0-9]{40})/i);
          if (!match) {
            res.writeHead(404).end();
            return;
          }
          const hash = match[1].toLowerCase();
          const engine = this.enginesMap.get(hash);
          const file = engine ? this.getActiveTargetFile(hash, engine) || this.findMainVideoFile(engine) : null;
          if (!engine || !file) {
            res.writeHead(404).end();
            return;
          }
          const fileSize = file.length;
          const fileOffset = file.offset || 0;
          const pieceLength = engine.torrent?.pieceLength || 1024 * 1024;
          const fileFirstPiece = Math.floor(fileOffset / pieceLength);
          const endPiece = Math.floor((fileOffset + fileSize - 1) / pieceLength);
          const bitfield = engine.bitfield;
          const parsed = parseHttpRange(req.headers.range, fileSize);
          if (parsed === "unsatisfiable") {
            res.writeHead(416, { "Content-Range": `bytes */${fileSize}` }).end();
            return;
          }
          if (parsed === null) {
            try {
              if (!bitfield || typeof bitfield.get !== "function" || !bitfield.get(fileFirstPiece)) {
                engine.critical?.(fileFirstPiece, 2);
                engine.select?.(fileFirstPiece, Math.min(endPiece, fileFirstPiece + 1), 120);
              }
            } catch {
            }
            res.writeHead(200, {
              "Content-Length": fileSize,
              "Accept-Ranges": "bytes",
              "Content-Type": "application/octet-stream"
            });
            const rs2 = file.createReadStream();
            rs2._isIndexProbe = true;
            this.registerReadStream(hash, rs2);
            rs2.on("error", () => {
              this.unregisterReadStream(hash, rs2);
              try {
                rs2.destroy();
              } catch {
              }
              if (!res.headersSent) res.writeHead(500).end();
            });
            rs2.pipe(res);
            req.on("close", () => {
              this.unregisterReadStream(hash, rs2);
              try {
                rs2.destroy();
              } catch {
              }
            });
            return;
          }
          const { start, end } = parsed;
          const reqStartPiece = Math.floor((fileOffset + start) / pieceLength);
          const isHeaderOrTailProbe = reqStartPiece <= fileFirstPiece + 1 || reqStartPiece >= Math.max(fileFirstPiece + 2, endPiece - 2);
          if (isHeaderOrTailProbe) {
            try {
              const probeEndPiece = Math.min(endPiece, reqStartPiece + 1);
              if (!bitfield || typeof bitfield.get !== "function" || !bitfield.get(reqStartPiece)) {
                engine.critical?.(reqStartPiece, probeEndPiece - reqStartPiece + 1);
                engine.select?.(reqStartPiece, probeEndPiece, 120);
              }
            } catch {
            }
          } else {
            this.optimizePiecePriorities(engine, start, file);
          }
          res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": end - start + 1,
            "Content-Type": "application/octet-stream"
          });
          const rs = file.createReadStream({ start, end });
          rs._isIndexProbe = isHeaderOrTailProbe;
          rs._isPlaybackStream = !isHeaderOrTailProbe;
          this.registerReadStream(hash, rs);
          rs.on("error", () => {
            this.unregisterReadStream(hash, rs);
            try {
              rs.destroy();
            } catch {
            }
            if (!res.headersSent) res.writeHead(500).end();
          });
          rs.pipe(res);
          req.on("close", () => {
            this.unregisterReadStream(hash, rs);
            try {
              rs.destroy();
            } catch {
            }
          });
        } catch {
          if (!res.headersSent) res.writeHead(500).end();
        }
      });
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        if (addr && typeof addr === "object") {
          this.localRawPort = addr.port;
        }
      });
      this.localRawServer = srv;
    } catch {
    }
  }
  registerReadStream(hash, rs) {
    if (!this.activeReadStreamsMap.has(hash)) {
      this.activeReadStreamsMap.set(hash, /* @__PURE__ */ new Set());
    }
    this.activeReadStreamsMap.get(hash).add(rs);
    if (rs && typeof rs.once === "function") {
      const autoRemove = () => this.unregisterReadStream(hash, rs);
      rs.once("end", autoRemove);
      rs.once("close", autoRemove);
      rs.once("error", autoRemove);
    }
    const engine = this.enginesMap.get(hash);
    if (engine && typeof engine.swarm?.resume === "function") {
      try {
        engine.swarm.resume();
      } catch {
      }
    }
  }
  unregisterReadStream(hash, rs) {
    const set = this.activeReadStreamsMap.get(hash);
    if (set) {
      set.delete(rs);
      if (set.size === 0) {
        this.activeReadStreamsMap.delete(hash);
      }
    }
  }
  getTrackerPriority() {
    return this.defaultTrackerPriority;
  }
  setTrackerPriority(mode, magnetUri) {
    this.defaultTrackerPriority = mode;
    if (magnetUri) {
      const hash = extractHash(magnetUri);
      const meta = this.runtimeMetaMap.get(hash);
      if (meta) meta.trackerPriority = mode;
      this.forceRetryPeers(magnetUri, mode).catch(() => {
      });
    }
  }
  /**
   * Obtém ou inicializa uma única instância compartilhada do motor torrent por infoHash
   */
  async getOrAddEngine(magnetUri, trackerPriority, targetOpts) {
    const hash = extractHash(magnetUri);
    const activePriority = trackerPriority || this.defaultTrackerPriority;
    if (this.cleanupTimers.has(hash)) {
      clearTimeout(this.cleanupTimers.get(hash));
      this.cleanupTimers.delete(hash);
    }
    if (!this.enginesMap.has(hash) && !this.pendingEnginesMap.has(hash) && this.enginesMap.size >= MAX_ACTIVE_ENGINES) {
      const freed = this.evictOldestInactiveEngine();
      if (!freed) {
        throw new Error("SERVER_CAPACITY_REACHED");
      }
    }
    const existing = this.enginesMap.get(hash);
    if (existing && existing.files && existing.files.length > 0) {
      this.activeStreamsCount.set(hash, (this.activeStreamsCount.get(hash) || 0) + 1);
      this.touchActivity(hash);
      if (trackerPriority) {
        const meta = this.runtimeMetaMap.get(hash);
        if (meta && meta.trackerPriority !== trackerPriority) {
          meta.trackerPriority = trackerPriority;
          this.retryPeersInternal(hash, existing, trackerPriority, false);
        }
      }
      return existing;
    }
    if (this.pendingEnginesMap.has(hash)) {
      const sharedEngine = await this.pendingEnginesMap.get(hash);
      this.activeStreamsCount.set(hash, (this.activeStreamsCount.get(hash) || 0) + 1);
      this.touchActivity(hash);
      return sharedEngine;
    }
    const initPromise = (async () => {
      let torrentInput = magnetUri;
      try {
        const cachedBuf = await fetchTorrentBuffer(hash);
        if (cachedBuf) {
          torrentInput = cachedBuf;
          console.log(`[P2P Cache] Metadados .torrent obtidos via cache para ${hash.slice(0, 8)}... (${cachedBuf.length} bytes)`);
        }
      } catch {
      }
      const selectedTrackers = Array.from(
        /* @__PURE__ */ new Set([...SUPER_TRACKERS, ...getTrackersForPriority(activePriority)])
      ).filter((tr) => /^(udp|https?):\/\//i.test(tr));
      const engineOpts = {
        tmp: CACHE_BASE_DIR,
        path: path.join(CACHE_BASE_DIR, hash),
        trackers: selectedTrackers,
        dht: true,
        tracker: true,
        connections: activePriority === "ultra-speed" ? 120 : 85,
        uploads: 4,
        verify: false
      };
      return await new Promise((resolve, reject) => {
        let engine;
        try {
          engine = torrentStream(torrentInput, engineOpts);
        } catch (parseErr) {
          console.warn(`[TorrentEngine] Fallback para Magnet URI em ${hash}:`, parseErr?.message);
          engine = torrentStream(magnetUri, engineOpts);
        }
        try {
          const explicitPort = 49152 + this.portCursor++ % 14e3;
          if (typeof engine.listen === "function") {
            engine.listen(explicitPort);
          }
          if (this.sharedDht && typeof this.sharedDht.lookup === "function") {
            this.sharedDht.lookup(hash);
          }
        } catch {
        }
        this.enginesMap.set(hash, engine);
        this.activeStreamsCount.set(hash, 1);
        this.runtimeMetaMap.set(hash, {
          createdAt: Date.now(),
          lastActivityTimestamp: Date.now(),
          trackerPriority: activePriority,
          autoRetryCount: 0,
          lastSeekOffset: 0,
          lastDownloadedBytes: 0,
          lastSampleAt: Date.now(),
          smoothedSpeed: 0
        });
        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved && (!engine.files || engine.files.length === 0)) {
            console.warn(`[P2P Timeout] Metadados n\xE3o responderam em 25s para ${hash.slice(0, 8)}... (Nenhuma semente conect\xE1vel nos trackers selecionados)`);
            try {
              engine.destroy(() => {
              });
            } catch {
            }
            this.enginesMap.delete(hash);
            this.runtimeMetaMap.delete(hash);
            this.stopWireOptimizer(hash);
            reject(new Error("P2P_PEER_TIMEOUT: Nenhuma semente respondeu a tempo."));
          }
        }, 25e3);
        engine.on("ready", () => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          this.enginesMap.set(hash, engine);
          const initialTarget = this.findTargetVideoFile(
            engine,
            targetOpts?.fileIdx,
            targetOpts?.season,
            targetOpts?.episode
          );
          if (initialTarget) {
            this.optimizePiecePriorities(engine, 0, initialTarget);
          }
          this.startWireOptimizer(hash, engine);
          resolve(engine);
        });
        engine.on("error", (err) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          console.warn("[TorrentEngine] Erro na inicializa\xE7\xE3o:", err?.message || err);
          try {
            engine.destroy(() => {
            });
          } catch {
          }
          this.enginesMap.delete(hash);
          this.runtimeMetaMap.delete(hash);
          this.stopWireOptimizer(hash);
          reject(err);
        });
      });
    })();
    this.pendingEnginesMap.set(hash, initPromise);
    try {
      return await initPromise;
    } finally {
      this.pendingEnginesMap.delete(hash);
    }
  }
  getActiveTargetFile(hash, engine) {
    const eng = engine || this.enginesMap.get(hash);
    if (!eng || !eng.files || eng.files.length === 0) return null;
    const meta = this.runtimeMetaMap.get(hash);
    if (meta?.targetFile && eng.files.includes(meta.targetFile)) {
      return meta.targetFile;
    }
    return this.findTargetVideoFile(eng);
  }
  matchEpisodeInFileList(candidateFiles, season, episode) {
    if (typeof episode !== "number" || episode <= 0 || candidateFiles.length === 0) {
      return null;
    }
    const epNum = episode;
    const epPadded = epNum.toString().padStart(2, "0");
    const epPadded3 = epNum.toString().padStart(3, "0");
    const sNum = typeof season === "number" && season > 0 ? season : void 0;
    const sortedCandidates = [...candidateFiles].sort((a, b) => {
      const pathA = String(a.path || a.name || "");
      const pathB = String(b.path || b.name || "");
      return pathA.localeCompare(pathB, void 0, { numeric: true, sensitivity: "base" });
    });
    let seasonFiltered = sortedCandidates;
    if (sNum) {
      const seasonRegex = new RegExp(
        `(?:[sS]0*${sNum}(?![0-9])|[sS]eason\\s*0*${sNum}(?![0-9])|[tT]emporada\\s*0*${sNum}(?![0-9])|\\b${sNum}x\\d+)`,
        "i"
      );
      const matchingSeason = sortedCandidates.filter(
        (f) => seasonRegex.test(String(f.path || f.name || ""))
      );
      if (matchingSeason.length > 0) {
        seasonFiltered = matchingSeason;
      }
    }
    const strictPatterns = [];
    if (sNum) {
      strictPatterns.push(new RegExp(`[sS]0*${sNum}[._\\s-]*[eE]p?0*${epNum}(?:v\\d+)?(?!\\d)`, "i"));
      strictPatterns.push(new RegExp(`(?:^|[^0-9])${sNum}x0*${epNum}(?:v\\d+)?(?!\\d)`, "i"));
      strictPatterns.push(new RegExp(`[sS]eason\\s*0*${sNum}.*?[eE]p?(?:isode)?\\.?\\s*0*${epNum}(?:v\\d+)?(?!\\d)`, "i"));
      strictPatterns.push(new RegExp(`[tT]emporada\\s*0*${sNum}.*?[eE]p?(?:is[o\xF3]dio)?\\.?\\s*0*${epNum}(?:v\\d+)?(?!\\d)`, "i"));
    }
    strictPatterns.push(new RegExp(`[sS]\\d+[._\\s-]*[eE]p?0*${epNum}(?:v\\d+)?(?!\\d)`, "i"));
    strictPatterns.push(new RegExp(`(?:^|[\\s._\\-\\[\\(])[eE]p?(?:isode|isodio|is\xF3dio)?\\.?[\\s._-]*0*${epNum}(?:v\\d+)?(?!\\d)`, "i"));
    strictPatterns.push(new RegExp(`(?:^|[\\s._\\-\\[\\(])cap(?:itulo|\xEDtulo)?\\.?[\\s._-]*0*${epNum}(?:v\\d+)?(?!\\d)`, "i"));
    const stripTechNoise = (raw) => raw.replace(/\b(2160p|1080p|720p|480p|360p|4k|uhd|fhd|hd)\b/gi, " ").replace(/[._\s-](2160p|1080p|720p|480p|h264|x264|h265|x265|hevc|av1|10bit|8bit|hdr10|hdr|ddp5[._]?1|dd5[._]?1|aac2[._]?0|aac|ac3|eac3|5[._]1|7[._]1|2[._]0|dual|dublado|legendado)/gi, " ").replace(/\b(19|20)\d{2}\b/g, " ");
    for (const pat of strictPatterns) {
      const found = seasonFiltered.find((f) => {
        const fullName = String(f.path || f.name || "");
        return pat.test(stripTechNoise(fullName));
      });
      if (found) return found;
    }
    const loosePatterns = [
      new RegExp(`[-_\\s\\[]0*${epNum}(?:v\\d+)?(?=[\\s_.\\]\\(]|$)`, "i"),
      new RegExp(`(?:^|[^0-9a-zA-Z])${epPadded3}(?!\\d)`),
      new RegExp(`(?:^|[^0-9a-zA-Z])${epPadded}(?!\\d)`)
    ];
    for (const pat of loosePatterns) {
      const found = seasonFiltered.find((f) => {
        const withoutSeasonAndTech = stripTechNoise(f.name).replace(/[sS]0*\d+[._\s-]*[eE]0*\d+/g, " ").replace(/[sS]0*\d+/g, " ").replace(/\d+[ªa]?\s*temporada/gi, " ").replace(/season\s*0*\d+/gi, " ");
        return pat.test(withoutSeasonAndTech);
      });
      if (found) return found;
    }
    if (seasonFiltered.length >= epNum && seasonFiltered.length > 1) {
      return seasonFiltered[epNum - 1];
    }
    return null;
  }
  findTargetVideoFile(engine, fileIdx, season, episode) {
    if (!engine.files || engine.files.length === 0) return null;
    const hash = engine.infoHash?.toLowerCase?.();
    const meta = hash ? this.runtimeMetaMap.get(hash) : void 0;
    const videoExts = [".mp4", ".mkv", ".webm", ".m4v", ".mov", ".avi", ".ts"];
    const allVideoFiles = engine.files.filter(
      (f) => videoExts.some((ext) => f.name.toLowerCase().endsWith(ext))
    );
    const nonSampleVideoFiles = allVideoFiles.filter(
      (f) => !/\bsample\b/i.test(f.name) || f.length > 25 * 1024 * 1024
    );
    const videoFiles = nonSampleVideoFiles.length > 0 ? nonSampleVideoFiles : allVideoFiles;
    const candidateFiles = videoFiles.length > 0 ? videoFiles : engine.files;
    const selectOnlyTarget = (target) => {
      for (const f of engine.files) {
        if (f !== target) {
          try {
            f.deselect?.();
          } catch {
          }
        }
      }
      if (meta) {
        if (meta.targetFile && meta.targetFile !== target) {
          meta.lastSeekOffset = 0;
        }
        meta.targetFile = target;
      }
      return target;
    };
    if (typeof episode === "number" && episode > 0) {
      const matchedByEpisode = this.matchEpisodeInFileList(candidateFiles, season, episode);
      if (typeof fileIdx === "number" && fileIdx >= 0 && fileIdx < engine.files.length) {
        const indexedFile = engine.files[fileIdx];
        const isIndexedVideo = videoFiles.length === 0 || videoFiles.includes(indexedFile);
        if (isIndexedVideo) {
          if (!matchedByEpisode || matchedByEpisode === indexedFile) {
            return selectOnlyTarget(indexedFile);
          }
          return selectOnlyTarget(matchedByEpisode);
        }
      }
      if (matchedByEpisode) {
        return selectOnlyTarget(matchedByEpisode);
      }
    }
    if (typeof fileIdx === "number" && fileIdx >= 0 && fileIdx < engine.files.length) {
      const target = engine.files[fileIdx];
      if (videoFiles.length === 0 || videoFiles.includes(target)) {
        return selectOnlyTarget(target);
      }
    }
    const main = candidateFiles.reduce((prev, curr) => curr.length > prev.length ? curr : prev);
    return selectOnlyTarget(main);
  }
  findMainVideoFile(engine) {
    const hash = engine.infoHash?.toLowerCase?.();
    if (hash) {
      const meta = this.runtimeMetaMap.get(hash);
      if (meta?.targetFile && engine.files.includes(meta.targetFile)) {
        return meta.targetFile;
      }
    }
    return this.findTargetVideoFile(engine);
  }
  retryPeersInternal(hash, engine, priorityMode, isAuto = true) {
    const meta = this.runtimeMetaMap.get(hash) || {
      createdAt: Date.now(),
      lastActivityTimestamp: Date.now(),
      trackerPriority: priorityMode || this.defaultTrackerPriority,
      autoRetryCount: 0,
      lastSeekOffset: 0,
      lastDownloadedBytes: 0,
      lastSampleAt: Date.now(),
      smoothedSpeed: 0
    };
    if (priorityMode) {
      meta.trackerPriority = priorityMode;
    }
    meta.autoRetryCount += 1;
    meta.lastRetryTimestamp = Date.now();
    this.runtimeMetaMap.set(hash, meta);
    let connectedAfter = 0;
    try {
      const anyEngine = engine;
      const swarm = engine.swarm;
      if (swarm && Array.isArray(swarm.wires)) {
        for (const wire of [...swarm.wires]) {
          if (!wire) continue;
          const wireSpeed = typeof wire.downloadSpeed === "function" ? wire.downloadSpeed() : 0;
          if (wire.destroyed || wire.peerChoking && wireSpeed === 0 && swarm.wires.length > 14) {
            try {
              wire.destroy?.();
            } catch {
            }
          } else {
            wire.amInterested = true;
            try {
              wire.unchoke?.();
            } catch {
            }
          }
        }
        connectedAfter = swarm.wires.filter((w) => w && !w.destroyed).length;
      }
      const trackers = getTrackersForPriority(meta.trackerPriority);
      if (Array.isArray(anyEngine.trackers)) {
        for (const tr of trackers) {
          if (!anyEngine.trackers.includes(tr)) {
            anyEngine.trackers.push(tr);
          }
        }
      }
      if (this.sharedDht && typeof this.sharedDht.lookup === "function") {
        try {
          this.sharedDht.lookup(hash);
        } catch {
        }
      }
      if (swarm && typeof swarm.resume === "function") {
        swarm.resume();
      }
      this.advanceSlidingPieceWindow(hash, engine);
      console.log(
        `[TorrentEngine] ${isAuto ? "Auto Re-try" : "Re-try Manual"} em ${hash} [perfil=${meta.trackerPriority}, #${meta.autoRetryCount}, peers=${connectedAfter}]`
      );
    } catch (err) {
      console.warn("[TorrentEngine] Aviso durante re-try:", err.message);
    }
    return {
      retried: true,
      numPeers: connectedAfter,
      autoRetryCount: meta.autoRetryCount,
      trackerPriority: meta.trackerPriority
    };
  }
  async forceRetryPeers(magnetUri, trackerPriority) {
    const hash = extractHash(magnetUri);
    let engine = this.enginesMap.get(hash);
    if (!engine) {
      try {
        engine = await this.getOrAddEngine(magnetUri, trackerPriority);
      } catch {
        return { success: false, retried: false, stats: null };
      }
    }
    this.retryPeersInternal(hash, engine, trackerPriority, false);
    return {
      success: true,
      retried: true,
      stats: this.getStats(magnetUri)
    };
  }
  /**
   * Limpa seleções customizadas antigas (priority >= 10) sem tocar nos streams ativos (priority === 1)
   * e aplica janela deslizante contínua à frente do cursor de leitura real!
   */
  applyCleanPriorityWindow(engine, startPiece, endPiece, includeEndPieceForIndex = false) {
    try {
      const anyEngine = engine;
      const bitfield = anyEngine.bitfield;
      if (Array.isArray(anyEngine.selection)) {
        for (let i = anyEngine.selection.length - 1; i >= 0; i--) {
          const sel = anyEngine.selection[i];
          if (sel && (sel.priority >= 10 || sel.priority === 0 || !sel.priority)) {
            anyEngine.selection.splice(i, 1);
          }
        }
      }
      const endTailStart = Math.max(startPiece + 3, endPiece - 2);
      const needsEndIndex = includeEndPieceForIndex && endPiece > startPiece + 3 && (!bitfield || typeof bitfield.get !== "function" || !bitfield.get(endPiece) || !bitfield.get(endTailStart));
      if (typeof anyEngine.critical === "function") {
        const critWidth = Math.max(2, Math.min(4, endPiece - startPiece + 1));
        anyEngine.critical(startPiece, critWidth);
        if (needsEndIndex) {
          anyEngine.critical(endTailStart, endPiece - endTailStart + 1);
        }
      }
      if (typeof anyEngine.select === "function") {
        if (needsEndIndex) {
          anyEngine.select(endTailStart, endPiece, 120);
        }
        anyEngine.select(startPiece, Math.min(endPiece, startPiece + 3), 100);
        anyEngine.select(startPiece, Math.min(endPiece, startPiece + 12), 50);
        anyEngine.select(startPiece, Math.min(endPiece, startPiece + 25), 20);
        anyEngine.select(startPiece, endPiece, 10);
      }
      if (typeof anyEngine.flood === "function") {
        anyEngine.flood();
      }
    } catch {
    }
  }
  /**
   * Avança automaticamente a janela de prioridade acompanhando o stream mais recente (stream._piece)
   * e pré-carrega em segundo plano os últimos blocos (índice Cues/moov) assim que a abertura já carregou!
   */
  advanceSlidingPieceWindow(hash, engine) {
    const mainFile = this.getActiveTargetFile(hash, engine) || this.findMainVideoFile(engine);
    if (!mainFile) return;
    const fileOffset = mainFile.offset || 0;
    const pieceLength = engine.torrent?.pieceLength || 1024 * 1024;
    const fileFirstPiece = Math.floor(fileOffset / pieceLength);
    const endPiece = Math.floor((fileOffset + mainFile.length - 1) / pieceLength);
    const bitfield = engine.bitfield;
    const openingAlreadyCached = Boolean(
      bitfield && typeof bitfield.get === "function" && bitfield.get(fileFirstPiece)
    );
    const activeStreams = this.activeReadStreamsMap.get(hash);
    if (activeStreams && activeStreams.size > 0) {
      const alivePlayback = Array.from(activeStreams).filter(
        (rs) => rs && !rs._destroyed && !rs.readableEnded && !rs._isIndexProbe && typeof rs._piece === "number" && (typeof rs._missing !== "number" || rs._missing > 0)
      );
      if (alivePlayback.length > 0) {
        const newestStream = alivePlayback[alivePlayback.length - 1];
        const targetPiece = Math.min(endPiece, newestStream._piece);
        this.applyCleanPriorityWindow(engine, targetPiece, endPiece, openingAlreadyCached);
        return;
      }
    }
    const meta = this.runtimeMetaMap.get(hash);
    const startPiece = Math.floor((fileOffset + (meta?.lastSeekOffset || 0)) / pieceLength);
    this.applyCleanPriorityWindow(engine, startPiece, endPiece, openingAlreadyCached || (meta?.lastSeekOffset || 0) > 0);
  }
  /**
   * Concentra toda a largura de banda P2P exatamente nos primeiros blocos a partir de seekByteOffset.
   * No início frio (seekByteOffset === 0), dedica 100% da banda apenas às primeiras peças antes de puxar o índice final!
   */
  optimizePiecePriorities(engine, seekByteOffset = 0, targetFile) {
    const hash = engine.infoHash?.toLowerCase?.();
    const mainFile = targetFile || (hash ? this.getActiveTargetFile(hash, engine) : null) || this.findMainVideoFile(engine);
    if (!mainFile) return;
    if (hash && this.runtimeMetaMap.has(hash)) {
      this.runtimeMetaMap.get(hash).lastSeekOffset = seekByteOffset;
      this.runtimeMetaMap.get(hash).targetFile = mainFile;
    }
    for (const file of engine.files) {
      if (file !== mainFile) {
        try {
          file.deselect();
        } catch {
        }
      }
    }
    const fileOffset = mainFile.offset || 0;
    const pieceLength = engine.torrent?.pieceLength || 1024 * 1024;
    const fileFirstPiece = Math.floor(fileOffset / pieceLength);
    const startPiece = Math.floor((fileOffset + seekByteOffset) / pieceLength);
    const endPiece = Math.floor((fileOffset + mainFile.length - 1) / pieceLength);
    const bitfield = engine.bitfield;
    const firstPieceReady = Boolean(
      bitfield && typeof bitfield.get === "function" && bitfield.get(fileFirstPiece)
    );
    this.applyCleanPriorityWindow(engine, startPiece, endPiece, firstPieceReady);
  }
  startWireOptimizer(hash, engine) {
    this.stopWireOptimizer(hash);
    const interval = setInterval(() => {
      try {
        const swarm = engine.swarm;
        const meta = this.runtimeMetaMap.get(hash);
        const now = Date.now();
        if (swarm && meta) {
          const downloadedNow = Number(swarm.downloaded) || 0;
          const dtSec = Math.max(0.5, (now - meta.lastSampleAt) / 1e3);
          const deltaSpeed = Math.max(0, (downloadedNow - meta.lastDownloadedBytes) / dtSec);
          const swarmFnSpeed = typeof swarm.downloadSpeed === "function" ? Number(swarm.downloadSpeed()) || 0 : 0;
          const instantSpeed = Math.max(swarmFnSpeed, deltaSpeed);
          meta.smoothedSpeed = meta.smoothedSpeed > 0 ? meta.smoothedSpeed * 0.45 + instantSpeed * 0.55 : instantSpeed;
          meta.lastDownloadedBytes = downloadedNow;
          meta.lastSampleAt = now;
        }
        this.advanceSlidingPieceWindow(hash, engine);
        const wires = Array.isArray(swarm?.wires) ? swarm.wires : [];
        const activeWires = wires.filter((w) => w && !w.destroyed);
        if (activeWires.length > 0) {
          activeWires.sort((a, b) => {
            const speedA = typeof a.downloadSpeed === "function" ? a.downloadSpeed() : 0;
            const speedB = typeof b.downloadSpeed === "function" ? b.downloadSpeed() : 0;
            return speedB - speedA;
          });
          const topPeersCount = Math.min(40, activeWires.length);
          for (let i = 0; i < topPeersCount; i++) {
            const wire = activeWires[i];
            wire.amInterested = true;
            if (typeof wire.unchoke === "function") {
              wire.unchoke();
            }
          }
        }
        if (meta && (this.activeStreamsCount.get(hash) || 0) > 0 && meta.autoRetryCount < 8) {
          const mainFile = this.findMainVideoFile(engine);
          const totalLen = mainFile ? mainFile.length : 1;
          const progress = (Number(swarm?.downloaded) || 0) / totalLen * 100;
          const aliveMs = now - meta.createdAt;
          const sinceLastRetryMs = meta.lastRetryTimestamp ? now - meta.lastRetryTimestamp : Infinity;
          const isLowTransfer = progress < 98 && aliveMs >= 8e3 && (meta.smoothedSpeed < LOW_SPEED_THRESHOLD_BYTES_SEC || activeWires.length < 2);
          if (isLowTransfer && sinceLastRetryMs >= AUTO_RETRY_COOLDOWN_MS) {
            this.retryPeersInternal(hash, engine, meta.trackerPriority, true);
          }
        }
      } catch {
      }
    }, 1800);
    this.wireOptimizerIntervals.set(hash, interval);
  }
  stopWireOptimizer(hash) {
    if (this.wireOptimizerIntervals.has(hash)) {
      clearInterval(this.wireOptimizerIntervals.get(hash));
      this.wireOptimizerIntervals.delete(hash);
    }
  }
  prefetchNextPieces(magnetUri, currentTimeSeconds, durationSeconds, detectedSpeedBytesPerSec = 1024 * 1024 * 2) {
    try {
      const hash = extractHash(magnetUri);
      const engine = this.enginesMap.get(hash);
      if (!engine) {
        return { success: false, prefetchedPieces: [], prefetchedCount: 0, targetWindow: 0 };
      }
      const mainFile = this.findMainVideoFile(engine);
      if (!mainFile) {
        return { success: false, prefetchedPieces: [], prefetchedCount: 0, targetWindow: 0 };
      }
      const fileOffset = mainFile.offset || 0;
      const pieceLength = engine.torrent?.pieceLength || 1024 * 1024;
      const endPiece = Math.floor((fileOffset + mainFile.length - 1) / pieceLength);
      let currentPiece = -1;
      let hasActivePlaybackStream = false;
      const activeStreams = this.activeReadStreamsMap.get(hash);
      if (activeStreams && activeStreams.size > 0) {
        const alivePlayback = Array.from(activeStreams).filter(
          (rs) => rs && !rs._destroyed && !rs.readableEnded && !rs._isIndexProbe && typeof rs._piece === "number" && (typeof rs._missing !== "number" || rs._missing > 0)
        );
        if (alivePlayback.length > 0) {
          hasActivePlaybackStream = true;
          currentPiece = alivePlayback[alivePlayback.length - 1]._piece;
        }
      }
      if (currentPiece < 0) {
        const dur = Math.max(1, durationSeconds);
        const currentByteOffset = Math.floor(Math.max(0, currentTimeSeconds) / dur * mainFile.length);
        currentPiece = Math.floor((fileOffset + currentByteOffset) / pieceLength);
      }
      const prefetchCount = detectedSpeedBytesPerSec > 2.5 * 1024 * 1024 ? 6 : 4;
      const startPrefetch = Math.min(endPiece, currentPiece);
      const endPrefetch = Math.min(endPiece, startPrefetch + prefetchCount - 1);
      const prefetchedPieces = [];
      for (let p = startPrefetch; p <= endPrefetch; p++) {
        prefetchedPieces.push(p);
      }
      const fileFirstPiece = Math.floor(fileOffset / pieceLength);
      const bitfield = engine.bitfield;
      const firstPieceReady = Boolean(
        bitfield && typeof bitfield.get === "function" && bitfield.get(fileFirstPiece)
      );
      if (this.runtimeMetaMap.has(hash) && currentTimeSeconds > 1 && !hasActivePlaybackStream) {
        const dur = Math.max(1, durationSeconds);
        this.runtimeMetaMap.get(hash).lastSeekOffset = Math.floor(
          Math.max(0, currentTimeSeconds) / dur * mainFile.length
        );
      }
      this.applyCleanPriorityWindow(engine, startPrefetch, endPiece, firstPieceReady || currentTimeSeconds > 1);
      return {
        success: true,
        prefetchedPieces,
        prefetchedCount: prefetchedPieces.length,
        targetWindow: prefetchCount
      };
    } catch {
      return { success: false, prefetchedPieces: [], prefetchedCount: 0, targetWindow: 0 };
    }
  }
  async preload(magnetUri, trackerPriority, targetOpts) {
    const hash = extractHash(magnetUri);
    try {
      const engine = await this.getOrAddEngine(magnetUri, trackerPriority, targetOpts);
      if (targetOpts && (typeof targetOpts.episode === "number" || typeof targetOpts.fileIdx === "number")) {
        const target = this.findTargetVideoFile(engine, targetOpts.fileIdx, targetOpts.season, targetOpts.episode);
        if (target) {
          this.optimizePiecePriorities(engine, 0, target);
        }
      }
      this.scheduleCleanup(hash, 75e3);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Lê os primeiros 128KB do arquivo validando que o enxame realmente está entregando bytes reais
   * (impede travamento infinito em torrents "fantasmas" com metadados .torrent em cache mas 0 peers reais!)
   */
  getOrProbeMediaInfo(hash, engine, file, timeoutMs = 14e3) {
    const bitfield = engine.bitfield;
    const fileOffset = file.offset || 0;
    const pieceLength = engine.torrent?.pieceLength || 1024 * 1024;
    const firstPiece = Math.floor(fileOffset / pieceLength);
    const hasPieceZero = Boolean(
      bitfield && typeof bitfield.get === "function" && bitfield.get(firstPiece)
    );
    const probeKey = `${hash}:${file.path || file.name}`;
    if (this.mediaProbeCache.has(probeKey) && hasPieceZero) {
      return Promise.resolve({ info: this.mediaProbeCache.get(probeKey) || null, gotBytes: true });
    }
    return new Promise((resolve) => {
      const readLen = Math.min(file.length - 1, 131071);
      if (readLen < 4096) {
        resolve({ info: null, gotBytes: true });
        return;
      }
      try {
        if (typeof engine.swarm?.resume === "function") {
          engine.swarm.resume();
        }
        engine.critical?.(firstPiece, 2);
        const wires = engine.swarm?.wires;
        if (Array.isArray(wires)) {
          for (const w of wires) {
            if (w) {
              w.amInterested = true;
              try {
                w.unchoke?.();
              } catch {
              }
            }
          }
        }
      } catch {
      }
      let done = false;
      const chunks = [];
      let total = 0;
      let rs = null;
      const finish = async (buf) => {
        if (done) return;
        done = true;
        if (rs) {
          this.unregisterReadStream(hash, rs);
          try {
            rs.destroy();
          } catch {
          }
        }
        if (!buf || buf.length === 0) {
          resolve({ info: null, gotBytes: false });
          return;
        }
        if (buf.length < 4096) {
          resolve({ info: null, gotBytes: true });
          return;
        }
        if (this.mediaProbeCache.has(probeKey)) {
          resolve({ info: this.mediaProbeCache.get(probeKey) || null, gotBytes: true });
          return;
        }
        const info = await transcoder.probeBufferStreams(buf);
        if (info) {
          this.mediaProbeCache.set(probeKey, info);
        }
        resolve({ info, gotBytes: true });
      };
      const timeout = setTimeout(() => {
        finish(total > 0 ? Buffer.concat(chunks) : null);
      }, timeoutMs);
      try {
        rs = file.createReadStream({ start: 0, end: readLen });
        this.registerReadStream(hash, rs);
        rs.on("data", (chunk) => {
          chunks.push(chunk);
          total += chunk.length;
          if (total >= readLen + 1) {
            clearTimeout(timeout);
            finish(Buffer.concat(chunks));
          }
        });
        rs.on("end", () => {
          clearTimeout(timeout);
          finish(total > 0 ? Buffer.concat(chunks) : null);
        });
        rs.on("error", () => {
          clearTimeout(timeout);
          finish(null);
        });
      } catch {
        clearTimeout(timeout);
        finish(null);
      }
    });
  }
  /**
   * Corrida paralela inteligente entre sementes da MESMA qualidade e MESMO idioma no início frio:
   * A primeira semente que entregar bytes reais de vídeo vence imediatamente, descartando torrents fantasmas sem peers!
   */
  async raceLiveCandidates(magnets, trackerPriority, timeoutMs = 10500) {
    const valid = magnets.filter(Boolean);
    if (valid.length <= 1) return valid[0] || "";
    const primaryHash = extractHash(valid[0]);
    const existingPrimary = this.enginesMap.get(primaryHash);
    if (existingPrimary && (existingPrimary.swarm?.downloaded || 0) > 32768) {
      return valid[0];
    }
    const pool = valid.slice(0, 2);
    let winnerHash = "";
    const racers = pool.map(async (mag, idx) => {
      const h = extractHash(mag);
      if (idx > 0) {
        await new Promise((r) => setTimeout(r, idx * 250));
        if (winnerHash) throw new Error("RACE_ALREADY_WON");
      }
      const eng = await this.getOrAddEngine(mag, trackerPriority);
      if (winnerHash && winnerHash !== h) {
        this.scheduleCleanup(h, 800);
        throw new Error("RACE_ALREADY_WON");
      }
      const f = this.findMainVideoFile(eng);
      if (!f) {
        this.scheduleCleanup(h, 800);
        throw new Error("NO_VIDEO_FILE");
      }
      this.optimizePiecePriorities(eng, 0);
      const { gotBytes } = await this.getOrProbeMediaInfo(h, eng, f, timeoutMs);
      if (!gotBytes) {
        this.scheduleCleanup(h, 800);
        throw new Error("DEAD_SWARM");
      }
      if (!winnerHash) {
        winnerHash = h;
      } else if (winnerHash !== h) {
        this.scheduleCleanup(h, 800);
        throw new Error("RACE_ALREADY_WON");
      }
      this.scheduleCleanup(h, 6e4);
      return mag;
    });
    try {
      const winnerMagnet = await Promise.any(racers);
      console.log(`[TorrentEngine] Semente ativa vencedora confirmada com bytes reais: ${extractHash(winnerMagnet)}`);
      return winnerMagnet;
    } catch {
      return valid[0];
    }
  }
  /**
   * FASE 4: Fecha automaticamente qualquer stream anterior do mesmo usuario/IP ao trocar de faixa ou abrir novo video
   */
  registerClientActiveStream(clientIp, hash, abortFn) {
    const prev = this.activeClientStreamByIp.get(clientIp);
    if (prev && prev.hash !== hash) {
      try {
        prev.abort();
      } catch {
      }
    }
    this.activeClientStreamByIp.set(clientIp, { hash, abort: abortFn });
  }
  /**
   * Streaming HTTP 206 Partial Content (MP4/WebM) ou Remuxing FFmpeg nativo em tempo real (MKV Dual Audio PT-BR)
   * com Health Check de 5 segundos (Fase 2) para downgrade automatico de qualidade (ex: 1080p -> 720p)
   * e blindagem de memoria (Fase 4) em req.on('close'), req.on('end') e res.on('error').
   */
  async handleStreamRequest(req, res, magnetUri, forceTranscode = false, audioOnly = false, trackerPriority, extra = {}) {
    const hash = extractHash(magnetUri);
    const clientIp = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || req.ip || "local").split(",")[0].trim();
    this.touchActivity(hash);
    let engine;
    try {
      engine = await this.getOrAddEngine(magnetUri, trackerPriority, {
        fileIdx: extra.fileIdx,
        season: extra.season,
        episode: extra.episode
      });
    } catch (err) {
      if (extra.fallbackMagnet && !extra.isFallbackAttempt) {
        this.destroyEngine(hash, true);
        const fbQual = extra.fallbackQuality || "720p";
        res.setHeader("X-Popoca-Quality-Fallback", fbQual);
        res.setHeader(
          "X-Popoca-Fallback-Message",
          `Conex\xE3o ajustada para ${fbQual} para reprodu\xE7\xE3o imediata`
        );
        return this.handleStreamRequest(req, res, extra.fallbackMagnet, forceTranscode, audioOnly, trackerPriority, {
          ...extra,
          fileIdx: extra.fallbackFileIdx,
          fallbackMagnet: void 0,
          isFallbackAttempt: true
        });
      }
      throw err;
    }
    const file = this.findTargetVideoFile(engine, extra.fileIdx, extra.season, extra.episode);
    if (!file) {
      this.scheduleCleanup(hash, 5e3);
      throw new Error("VIDEO_FILE_NOT_FOUND: Arquivo de v\xEDdeo n\xE3o encontrado no torrent.");
    }
    const isWebNative = transcoder.isWebNative(file.name);
    const seekSec = extra.seekSeconds && extra.seekSeconds > 0 ? extra.seekSeconds : 0;
    const hasCustomAudioTrack = typeof extra.audioTrackIndex === "number" && extra.audioTrackIndex >= 0;
    const needsTranscode = forceTranscode || audioOnly || !isWebNative || hasCustomAudioTrack;
    res.setHeader(
      "Access-Control-Expose-Headers",
      "X-Popoca-Stream-Mode, X-Popoca-Active-Hash, X-Popoca-Real-Lang, X-Popoca-Quality-Fallback, X-Popoca-Fallback-Message, Content-Range, Accept-Ranges"
    );
    const hasFallback = Boolean(extra.fallbackMagnet && !extra.isFallbackAttempt && seekSec === 0);
    const canFailoverQuickly = Boolean((hasFallback || extra.hasAlternatives) && seekSec === 0);
    const activeWiresCount = Array.isArray(engine.swarm?.wires) ? engine.swarm.wires.filter((w) => w && !w.destroyed).length : 0;
    const healthTimeoutMs = canFailoverQuickly && activeWiresCount === 0 && (engine.swarm?.downloaded || 0) === 0 ? HEALTH_CHECK_TIMEOUT_MS : canFailoverQuickly ? 6500 : 14e3;
    if (needsTranscode) {
      const rangeHeader = req.headers.range;
      if (rangeHeader && rangeHeader.startsWith("bytes=")) {
        const rangeStart = parseInt(rangeHeader.replace(/bytes=/, "").split("-")[0], 10);
        if (!isNaN(rangeStart) && rangeStart > 0) {
          this.scheduleCleanup(hash, 3e4);
          res.status(416).end();
          return;
        }
      }
      const clientKey = `${clientIp}:${hash}`;
      const prevCancel = this.activeClientTranscodeMap.get(clientKey);
      if (prevCancel) {
        this.activeClientTranscodeMap.delete(clientKey);
        try {
          prevCancel();
        } catch {
        }
      }
      const fileOffset = file.offset || 0;
      const pieceLength = engine.torrent?.pieceLength || 1024 * 1024;
      const fileFirstPiece = Math.floor(fileOffset / pieceLength);
      const endPiece = Math.floor((fileOffset + file.length - 1) / pieceLength);
      const bitfield = engine.bitfield;
      const endIndexCached = Boolean(
        bitfield && typeof bitfield.get === "function" && bitfield.get(endPiece)
      );
      const useHttpLoopbackSeek = seekSec > 1.5 && this.localRawPort > 0;
      if (useHttpLoopbackSeek) {
        const meta = this.runtimeMetaMap.get(hash);
        const estOffset = meta?.lastSeekOffset && meta.lastSeekOffset > 0 ? meta.lastSeekOffset : Math.min(file.length - 1, Math.floor(seekSec / 6600 * file.length));
        const estStartPiece = Math.floor((fileOffset + estOffset) / pieceLength);
        this.applyCleanPriorityWindow(engine, estStartPiece, endPiece, true);
        if (!endIndexCached) {
          try {
            engine.critical?.(Math.max(fileFirstPiece, endPiece - 1), 2);
          } catch {
          }
        }
      } else {
        this.optimizePiecePriorities(engine, 0, file);
      }
      const { info: probedInfo, gotBytes } = await this.getOrProbeMediaInfo(
        hash,
        engine,
        file,
        healthTimeoutMs
      );
      if (req.destroyed || res.writableEnded) {
        this.scheduleCleanup(hash, 15e3);
        return;
      }
      if (!gotBytes) {
        if (hasFallback && extra.fallbackMagnet) {
          const fbQual = extra.fallbackQuality || "720p";
          console.log(
            `[Health Check 5s] Qualidade ${extra.preferredQuality || "1080p"} sem velocidade suficiente em 5s. Fazendo downgrade automatico para ${fbQual}.`
          );
          this.scheduleCleanup(hash, 5e3);
          res.setHeader("X-Popoca-Quality-Fallback", fbQual);
          res.setHeader(
            "X-Popoca-Fallback-Message",
            `Conex\xE3o ajustada para ${fbQual} para reprodu\xE7\xE3o imediata`
          );
          return this.handleStreamRequest(
            req,
            res,
            extra.fallbackMagnet,
            forceTranscode,
            audioOnly,
            trackerPriority,
            {
              ...extra,
              fileIdx: extra.fallbackFileIdx,
              fallbackMagnet: void 0,
              isFallbackAttempt: true
            }
          );
        }
        this.scheduleCleanup(hash, 5e3);
        throw new Error("P2P_SWARM_NO_BYTES: Nenhum peer entregou blocos a tempo.");
      }
      res.status(200);
      res.setHeader("X-Popoca-Stream-Mode", "transcode");
      res.setHeader("X-Popoca-Active-Hash", hash);
      if (probedInfo?.hasPortugueseAudioTrack === false && extra.preferPortugueseAudio) {
        res.setHeader("X-Popoca-Real-Lang", "en");
      } else if (probedInfo?.hasPortugueseAudioTrack) {
        res.setHeader("X-Popoca-Real-Lang", "pt-br");
      }
      res.setHeader("Content-Type", audioOnly ? "audio/aac" : "video/mp4");
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }
      let directReadStream = null;
      let inputSource;
      if (useHttpLoopbackSeek) {
        inputSource = `http://127.0.0.1:${this.localRawPort}/raw/${hash}`;
      } else {
        directReadStream = file.createReadStream();
        this.registerReadStream(hash, directReadStream);
        inputSource = directReadStream;
      }
      let cleanedUp = false;
      const triggerOnceCleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        if (this.activeClientTranscodeMap.get(clientKey) === abortCurrentTranscode) {
          this.activeClientTranscodeMap.delete(clientKey);
        }
        if (directReadStream) {
          this.unregisterReadStream(hash, directReadStream);
          try {
            directReadStream.destroy();
          } catch {
          }
        }
        this.scheduleCleanup(hash, 25e3);
      };
      const transcodeJob = transcoder.transcodeStream(inputSource, res, {
        seekSeconds: seekSec > 1.5 ? seekSec : void 0,
        audioOnly,
        preferPortugueseAudio: extra.preferPortugueseAudio !== false,
        audioTrackIndex: extra.audioTrackIndex,
        probedInfo,
        sourceFileName: `${magnetUri} ${file.name}`,
        priority: 1,
        onCancel: triggerOnceCleanup
      });
      const abortCurrentTranscode = () => {
        try {
          if (directReadStream) directReadStream.destroy();
          transcodeJob.cancel();
        } catch {
        }
        triggerOnceCleanup();
      };
      this.activeClientTranscodeMap.set(clientKey, abortCurrentTranscode);
      this.registerClientActiveStream(clientIp, hash, abortCurrentTranscode);
      req.on("close", abortCurrentTranscode);
      req.on("end", abortCurrentTranscode);
      res.on("error", abortCurrentTranscode);
      return;
    }
    const fileSize = file.length;
    const parsedRange = parseHttpRange(req.headers.range, fileSize);
    if (parsedRange === "unsatisfiable") {
      this.scheduleCleanup(hash, 3e4);
      res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end();
      return;
    }
    if (parsedRange === null) {
      this.optimizePiecePriorities(engine, 0, file);
      res.setHeader("X-Popoca-Stream-Mode", "native");
      res.setHeader("X-Popoca-Active-Hash", hash);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Length", fileSize);
      res.setHeader("Accept-Ranges", "bytes");
      const readStream = file.createReadStream();
      this.registerReadStream(hash, readStream);
      let closed = false;
      const cleanupFullStream = () => {
        if (closed) return;
        closed = true;
        this.unregisterReadStream(hash, readStream);
        try {
          readStream.destroy();
        } catch {
        }
        this.scheduleCleanup(hash, 25e3);
      };
      readStream.on("error", () => {
        cleanupFullStream();
        if (!res.headersSent) res.status(500).end();
      });
      readStream.pipe(res);
      req.on("close", cleanupFullStream);
      req.on("end", cleanupFullStream);
      res.on("error", cleanupFullStream);
      return;
    }
    const { start, end } = parsedRange;
    this.optimizePiecePriorities(engine, start, file);
    if (start === 0) {
      const { gotBytes } = await this.getOrProbeMediaInfo(hash, engine, file, healthTimeoutMs);
      if (req.destroyed || res.writableEnded) {
        this.scheduleCleanup(hash, 15e3);
        return;
      }
      if (!gotBytes) {
        if (hasFallback && extra.fallbackMagnet) {
          const fbQual = extra.fallbackQuality || "720p";
          console.log(
            `[Health Check 5s] Qualidade ${extra.preferredQuality || "1080p"} sem velocidade suficiente em 5s. Fazendo downgrade automatico para ${fbQual}.`
          );
          this.scheduleCleanup(hash, 5e3);
          res.setHeader("X-Popoca-Quality-Fallback", fbQual);
          res.setHeader(
            "X-Popoca-Fallback-Message",
            `Conex\xE3o ajustada para ${fbQual} para reprodu\xE7\xE3o imediata`
          );
          return this.handleStreamRequest(
            req,
            res,
            extra.fallbackMagnet,
            forceTranscode,
            audioOnly,
            trackerPriority,
            {
              ...extra,
              fileIdx: extra.fallbackFileIdx,
              fallbackMagnet: void 0,
              isFallbackAttempt: true
            }
          );
        }
        this.scheduleCleanup(hash, 5e3);
        throw new Error("P2P_SWARM_NO_BYTES: Nenhum peer entregou blocos MP4 a tempo.");
      }
    }
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      "X-Popoca-Stream-Mode": "native",
      "X-Popoca-Active-Hash": hash,
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": "video/mp4",
      "Cache-Control": "no-cache"
    });
    const chunkStream = file.createReadStream({ start, end });
    this.registerReadStream(hash, chunkStream);
    let chunkClosed = false;
    const cleanupChunkStream = () => {
      if (chunkClosed) return;
      chunkClosed = true;
      this.unregisterReadStream(hash, chunkStream);
      try {
        chunkStream.destroy();
      } catch {
      }
      this.scheduleCleanup(hash, 25e3);
    };
    chunkStream.on("error", () => {
      cleanupChunkStream();
      if (!res.headersSent) res.status(500).end();
    });
    chunkStream.pipe(res);
    req.on("close", cleanupChunkStream);
    req.on("end", cleanupChunkStream);
    res.on("error", cleanupChunkStream);
  }
  /**
   * FASE 3: Muxing Hibrido em Tempo Real (Video 4K/1080p EN + Audio 720p PT-BR)
   * Inicia duas instancias leves do torrent-stream com Super Trackers ativados e passa os streams
   * de leitura para o fluent-ffmpeg (-map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -ac 2)
   * entregando Fragmented MP4 via .pipe(res).
   */
  async handleHybridStreamRequest(req, res, videoMagnet, audioMagnet, options = {}) {
    const videoHash = extractHash(videoMagnet);
    const audioHash = extractHash(audioMagnet);
    const clientIp = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || req.ip || "local").split(",")[0].trim();
    const [videoEngine, audioEngine] = await Promise.all([
      this.getOrAddEngine(videoMagnet, options.trackerPriority),
      this.getOrAddEngine(audioMagnet, options.trackerPriority)
    ]);
    const videoFile = this.findTargetVideoFile(videoEngine, void 0, options.season, options.episode);
    const audioFile = this.findTargetVideoFile(audioEngine, void 0, options.season, options.episode);
    if (!videoFile || !audioFile) {
      this.scheduleCleanup(videoHash, 5e3);
      this.scheduleCleanup(audioHash, 5e3);
      throw new Error("HYBRID_FILES_NOT_FOUND: Arquivos de v\xEDdeo ou \xE1udio n\xE3o encontrados nos torrents.");
    }
    this.optimizePiecePriorities(videoEngine, 0, videoFile);
    this.optimizePiecePriorities(audioEngine, 0, audioFile);
    const [vProbe, aProbe] = await Promise.all([
      this.getOrProbeMediaInfo(videoHash, videoEngine, videoFile, 12e3),
      this.getOrProbeMediaInfo(audioHash, audioEngine, audioFile, 12e3)
    ]);
    if (req.destroyed || res.writableEnded) {
      this.scheduleCleanup(videoHash, 1e4);
      this.scheduleCleanup(audioHash, 1e4);
      return;
    }
    if (!vProbe.gotBytes || !aProbe.gotBytes) {
      this.scheduleCleanup(videoHash, 2e3);
      this.scheduleCleanup(audioHash, 2e3);
      throw new Error("HYBRID_SWARM_NO_BYTES: Enxame h\xEDbrido sem peers suficientes no momento.");
    }
    res.status(200);
    res.setHeader(
      "Access-Control-Expose-Headers",
      "X-Popoca-Stream-Mode, X-Popoca-Active-Hash, X-Popoca-Audio-Hash"
    );
    res.setHeader("X-Popoca-Stream-Mode", "hybrid-mux");
    res.setHeader("X-Popoca-Active-Hash", videoHash);
    res.setHeader("X-Popoca-Audio-Hash", audioHash);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }
    const seekSec = options.seekSeconds && options.seekSeconds > 0 ? options.seekSeconds : 0;
    const useLoopback = seekSec > 1.5 && this.localRawPort > 0;
    let videoReadStream = null;
    let audioReadStream = null;
    let videoInput;
    let audioInput;
    if (useLoopback) {
      videoInput = `http://127.0.0.1:${this.localRawPort}/raw/${videoHash}`;
      audioInput = `http://127.0.0.1:${this.localRawPort}/raw/${audioHash}`;
    } else {
      videoReadStream = videoFile.createReadStream();
      audioReadStream = audioFile.createReadStream();
      this.registerReadStream(videoHash, videoReadStream);
      this.registerReadStream(audioHash, audioReadStream);
      videoInput = videoReadStream;
      audioInput = audioReadStream;
    }
    let cleaned = false;
    const cleanupHybrid = () => {
      if (cleaned) return;
      cleaned = true;
      if (videoReadStream) {
        this.unregisterReadStream(videoHash, videoReadStream);
        try {
          videoReadStream.destroy();
        } catch {
        }
      }
      if (audioReadStream) {
        this.unregisterReadStream(audioHash, audioReadStream);
        try {
          audioReadStream.destroy();
        } catch {
        }
      }
      this.scheduleCleanup(videoHash, 1e4);
      this.scheduleCleanup(audioHash, 1e4);
    };
    const hybridJob = transcoder.transcodeHybridStream(videoInput, audioInput, res, {
      seekSeconds: seekSec > 1.5 ? seekSec : void 0,
      audioDelayMs: options.audioDelayMs,
      onCancel: cleanupHybrid
    });
    const abortHybrid = () => {
      try {
        hybridJob.cancel();
      } catch {
      }
      cleanupHybrid();
    };
    this.registerClientActiveStream(clientIp, `${videoHash}+${audioHash}`, abortHybrid);
    req.on("close", abortHybrid);
    req.on("end", abortHybrid);
    res.on("error", abortHybrid);
  }
  getStats(magnetUri) {
    try {
      const hash = extractHash(magnetUri);
      const engine = this.enginesMap.get(hash);
      if (!engine) return null;
      this.touchActivity(hash);
      const mainFile = this.findMainVideoFile(engine);
      const swarmAny = engine.swarm;
      const meta = this.runtimeMetaMap.get(hash);
      const downloaded = Number(swarmAny?.downloaded) || 0;
      const totalLength = mainFile ? mainFile.length : 1;
      const progress = Math.min(100, Number((downloaded / totalLength * 100).toFixed(1)));
      const wires = Array.isArray(swarmAny?.wires) ? swarmAny.wires.filter((w) => w && !w.destroyed) : [];
      const numPeers = wires.length;
      const activePeers = wires.filter((w) => {
        const spd = typeof w.downloadSpeed === "function" ? w.downloadSpeed() : 0;
        return !w.peerChoking || spd > 0;
      }).length;
      const swarmDl = typeof swarmAny?.downloadSpeed === "function" ? Number(swarmAny.downloadSpeed()) || 0 : 0;
      const swarmUl = typeof swarmAny?.uploadSpeed === "function" ? Number(swarmAny.uploadSpeed()) || 0 : 0;
      const downloadSpeed = Math.round(Math.max(swarmDl, meta?.smoothedSpeed || 0));
      const uploadSpeed = Math.round(swarmUl);
      const bitfield = engine.bitfield;
      const totalPieces = engine.torrent?.pieces ? engine.torrent.pieces.length : 0;
      const pieceLength = engine.torrent?.pieceLength || 0;
      const pieceMap = generatePieceMap(bitfield, totalPieces, 60);
      return {
        infoHash: hash,
        name: mainFile?.name || "V\xEDdeo Popoca",
        progress,
        downloadSpeed,
        uploadSpeed,
        numPeers,
        activePeers,
        length: totalLength,
        downloaded,
        trackerPriority: meta?.trackerPriority || this.defaultTrackerPriority,
        autoRetryCount: meta?.autoRetryCount || 0,
        lastRetryTimestamp: meta?.lastRetryTimestamp,
        isLowSpeed: progress < 98 && downloadSpeed < LOW_SPEED_THRESHOLD_BYTES_SEC,
        pieceMap,
        totalPieces,
        pieceLength
      };
    } catch {
      return null;
    }
  }
  getActiveEnginesCount() {
    return this.enginesMap.size;
  }
  touchActivity(hash) {
    const meta = this.runtimeMetaMap.get(hash.toLowerCase());
    if (meta) {
      meta.lastActivityTimestamp = Date.now();
    }
  }
  /**
   * Despeja (evict) da memória o motor inativo menos recentemente utilizado (LRU).
   * Retorna true se um motor inativo foi liberado, permitindo o reuso do slot no pool.
   */
  evictOldestInactiveEngine() {
    let oldestHash = null;
    let oldestActivity = Infinity;
    for (const [hash] of this.enginesMap.entries()) {
      const activeCount = this.activeStreamsCount.get(hash) || 0;
      if (activeCount <= 0) {
        const meta = this.runtimeMetaMap.get(hash);
        const lastActivity = meta ? meta.lastActivityTimestamp : 0;
        if (lastActivity < oldestActivity) {
          oldestActivity = lastActivity;
          oldestHash = hash;
        }
      }
    }
    if (!oldestHash) {
      return false;
    }
    console.log(`[TorrentEngine Pool] Despejando motor inativo mais antigo (LRU): ${oldestHash}`);
    this.destroyEngine(oldestHash);
    return true;
  }
  /**
   * Destrói completamente uma instância do motor torrent, limpando streams e memória.
   */
  destroyEngine(hash, removeDiskCache = false) {
    const cleanHash = hash.toLowerCase();
    if (this.cleanupTimers.has(cleanHash)) {
      clearTimeout(this.cleanupTimers.get(cleanHash));
      this.cleanupTimers.delete(cleanHash);
    }
    this.stopWireOptimizer(cleanHash);
    const activeStreams = this.activeReadStreamsMap.get(cleanHash);
    if (activeStreams) {
      for (const rs of activeStreams) {
        try {
          rs.destroy();
        } catch {
        }
      }
      this.activeReadStreamsMap.delete(cleanHash);
    }
    const engine = this.enginesMap.get(cleanHash);
    if (engine) {
      try {
        engine.destroy(() => {
        });
      } catch {
      }
    }
    this.enginesMap.delete(cleanHash);
    this.runtimeMetaMap.delete(cleanHash);
    this.activeStreamsCount.delete(cleanHash);
    this.mediaProbeCache.delete(cleanHash);
    if (removeDiskCache) {
      const torrentDir = path.join(CACHE_BASE_DIR, cleanHash);
      try {
        if (fs.existsSync(torrentDir)) {
          fs.rmSync(torrentDir, { recursive: true, force: true });
        }
      } catch {
      }
    }
  }
  /**
   * Limpa automaticamente o diretório de cache em disco:
   * 1. Remove torrents inativos com mais de 30 minutos (se não estiverem com reprodução ativa)
   * 2. Quando o uso total excede 80% do limite máximo (1.6GB), remove as pastas mais antigas até atingir 50% (1.0GB)
   */
  pruneDiskCache() {
    try {
      if (!fs.existsSync(CACHE_BASE_DIR)) {
        fs.mkdirSync(CACHE_BASE_DIR, { recursive: true });
        return { freedBytes: 0, currentBytes: 0 };
      }
      const now = Date.now();
      const entries = fs.readdirSync(CACHE_BASE_DIR, { withFileTypes: true });
      const folderList = [];
      let totalBytes = 0;
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(CACHE_BASE_DIR, entry.name);
        const hash = entry.name.toLowerCase();
        const activeCount = this.activeStreamsCount.get(hash) || 0;
        const isLocked = activeCount > 0;
        const info = getDirectorySize(dirPath);
        totalBytes += info.size;
        folderList.push({
          hash,
          dirPath,
          size: info.size,
          newest: info.newest,
          isLocked
        });
      }
      let freedBytes = 0;
      for (const folder of folderList) {
        if (folder.isLocked) continue;
        const idleMs = now - folder.newest;
        if (idleMs > INACTIVE_EVICT_MS) {
          try {
            fs.rmSync(folder.dirPath, { recursive: true, force: true });
            freedBytes += folder.size;
            totalBytes -= folder.size;
            console.log(
              `[TorrentEngine Cache] Despejo de torrent expirado (>30min): ${folder.hash} (${Math.round(folder.size / 1048576)} MB)`
            );
          } catch {
          }
        }
      }
      if (totalBytes > CACHE_HIGH_WATERMARK) {
        const candidates = folderList.filter((f) => !f.isLocked && fs.existsSync(f.dirPath)).sort((a, b) => a.newest - b.newest);
        for (const folder of candidates) {
          if (totalBytes <= CACHE_LOW_WATERMARK) break;
          try {
            fs.rmSync(folder.dirPath, { recursive: true, force: true });
            freedBytes += folder.size;
            totalBytes -= folder.size;
            console.log(
              `[TorrentEngine Cache] Poda por limite de disco (80% atingido): ${folder.hash} (${Math.round(folder.size / 1048576)} MB)`
            );
          } catch {
          }
        }
      }
      return { freedBytes, currentBytes: totalBytes };
    } catch (err) {
      console.warn("[TorrentEngine Cache] Erro ao podar cache em disco:", err);
      return { freedBytes: 0, currentBytes: 0 };
    }
  }
  startPeriodicSweeper() {
    const sweep = () => {
      try {
        const now = Date.now();
        for (const [hash] of Array.from(this.enginesMap.entries())) {
          const active = this.activeStreamsCount.get(hash) || 0;
          if (active <= 0) {
            const meta = this.runtimeMetaMap.get(hash);
            const lastActivity = meta ? meta.lastActivityTimestamp : 0;
            if (now - lastActivity > INACTIVE_EVICT_MS) {
              console.log(`[TorrentEngine Pool] Desalocando engine inativo (>30min): ${hash}`);
              this.destroyEngine(hash);
            }
          }
        }
        this.pruneDiskCache();
      } catch (err) {
        console.warn("[TorrentEngine] Erro no ciclo de limpeza peri\xF3dica:", err);
      }
    };
    setInterval(sweep, 5 * 60 * 1e3).unref();
  }
  scheduleCleanup(hash, delayMs = 6e4) {
    const current = (this.activeStreamsCount.get(hash) || 1) - 1;
    this.activeStreamsCount.set(hash, Math.max(0, current));
    this.touchActivity(hash);
    if (this.cleanupTimers.has(hash)) {
      clearTimeout(this.cleanupTimers.get(hash));
    }
    const timer = setTimeout(() => {
      const active = this.activeStreamsCount.get(hash) || 0;
      if (active <= 0) {
        if (this.enginesMap.size > MAX_ACTIVE_ENGINES) {
          console.log(`[TorrentEngine Pool] Liberando engine acima do limite de pool: ${hash}`);
          this.destroyEngine(hash);
        }
      }
    }, delayMs);
    this.cleanupTimers.set(hash, timer);
  }
};
var torrentEngine = new TorrentEngine();

// server/subtitleService.ts
var OPENSUBS_ADDON = "https://opensubtitles-v3.strem.io";
var LANG_MAP = {
  pob: { code: "pt-BR", label: "Portugu\xEAs (Brasil)", order: 0 },
  por: { code: "pt", label: "Portugu\xEAs (Portugal)", order: 1 },
  eng: { code: "en", label: "Ingl\xEAs", order: 2 },
  spa: { code: "es", label: "Espanhol", order: 3 }
};
var MAX_OPTIONS_PER_LANG = 3;
var FORMAT_TOKENS = [
  [/web[\s.-]?dl/i, "webdl"],
  [/web[\s.-]?rip/i, "webrip"],
  [/blu[\s.-]?ray|bdrip|brrip/i, "bluray"],
  [/hdtv/i, "hdtv"],
  [/\b(cam|hdcam|ts|telesync|hdts)\b/i, "cam"]
];
function detectFormat(text) {
  for (const [re, token] of FORMAT_TOKENS) {
    if (re.test(text)) return token;
  }
  return null;
}
function srtToVtt(srt) {
  const body = srt.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2").replace(/\{\\[^}]*\}/g, "").trim();
  if (body.startsWith("WEBVTT")) return body + "\n";
  return `WEBVTT

${body}
`;
}
var SubtitleService = class {
  constructor() {
    this.urlById = /* @__PURE__ */ new Map();
    this.listCache = /* @__PURE__ */ new Map();
    this.vttCache = /* @__PURE__ */ new Map();
  }
  remember(map, key, value, max) {
    if (map.has(key)) map.delete(key);
    map.set(key, value);
    while (map.size > max) {
      const oldest = map.keys().next().value;
      map.delete(oldest);
    }
  }
  /**
   * Lista as legendas reais disponíveis para um título (filme ou episódio)
   */
  async listTracks(opts) {
    const { imdbId, type, season, episode, fileName } = opts;
    if (!/^tt\d+$/.test(imdbId)) return [];
    const stremioId = type === "series" && season && episode ? `${imdbId}:${season}:${episode}` : imdbId;
    const cacheKey = `${type}|${stremioId}|${fileName || ""}`;
    const cached = this.listCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1e3) {
      return cached.tracks;
    }
    let raw = [];
    try {
      const res = await fetch(`${OPENSUBS_ADDON}/subtitles/${type}/${stremioId}.json`, {
        signal: AbortSignal.timeout(8e3)
      });
      if (res.ok) {
        const data = await res.json();
        raw = Array.isArray(data?.subtitles) ? data.subtitles : [];
      }
    } catch (err) {
      console.warn("[SubtitleService] Falha ao listar legendas:", err?.message || err);
      return [];
    }
    const fileFormat = fileName ? detectFormat(fileName) : null;
    const fileLower = (fileName || "").toLowerCase();
    const scored = raw.filter((s) => s && s.id && s.url && LANG_MAP[s.lang]).map((s, idx) => {
      let score = -idx * 0.1;
      const subText = `${s.movieReleaseName || ""} ${s.subtitleFileName || ""} ${s.releaseFormat || ""}`;
      const subFormat = detectFormat(subText);
      if (s.m === "h") score += 100;
      if (s.releaseGroup && fileLower.includes(s.releaseGroup.toLowerCase())) score += 50;
      if (fileFormat && subFormat === fileFormat) score += 30;
      if (subFormat === "cam" && fileFormat !== "cam") score -= 40;
      return { s, score };
    }).sort((a, b) => {
      const la = LANG_MAP[a.s.lang].order;
      const lb = LANG_MAP[b.s.lang].order;
      return la - lb || b.score - a.score;
    });
    const perLangCount = {};
    const tracks = [];
    for (const { s } of scored) {
      const info = LANG_MAP[s.lang];
      const n = (perLangCount[s.lang] || 0) + 1;
      if (n > MAX_OPTIONS_PER_LANG) continue;
      perLangCount[s.lang] = n;
      const id = `os-${s.id}`;
      this.remember(this.urlById, id, s.url, 2e3);
      tracks.push({
        id,
        lang: info.code,
        label: n === 1 ? info.label : `${info.label} \xB7 op\xE7\xE3o ${n}`,
        release: s.movieReleaseName || s.subtitleFileName
      });
    }
    this.remember(this.listCache, cacheKey, { at: Date.now(), tracks }, 300);
    return tracks;
  }
  /**
   * Baixa a legenda selecionada e devolve em WebVTT (apenas IDs previamente listados)
   */
  async getVtt(id) {
    const cached = this.vttCache.get(id);
    if (cached) return cached;
    const url = this.urlById.get(id);
    if (!url) return null;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1e4) });
      if (!res.ok) return null;
      const vtt = srtToVtt(await res.text());
      this.remember(this.vttCache, id, vtt, 60);
      return vtt;
    } catch (err) {
      console.warn("[SubtitleService] Falha ao baixar legenda:", err?.message || err);
      return null;
    }
  }
};
var subtitleService = new SubtitleService();

// server/database.ts
import { DatabaseSync } from "node:sqlite";
import path2 from "path";
import fs2 from "fs";
import crypto2 from "crypto";
var DATA_DIR = process.env.DATA_DIR || process.cwd();
try {
  if (!fs2.existsSync(DATA_DIR)) {
    fs2.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch {
}
var DB_PATH = path2.resolve(DATA_DIR, "popoca.db");
var EXAMPLE_JSON_PATH = path2.resolve(process.cwd(), "popoca-sync-data.example.json");
function toSafeUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    handle: user.handle,
    avatar_url: user.avatar_url,
    banner_url: user.banner_url,
    bio: user.bio,
    created_at: user.created_at,
    updated_at: user.updated_at
  };
}
function hashPassword(password) {
  const salt = crypto2.randomBytes(16).toString("hex");
  const hash = crypto2.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  try {
    if (!stored || stored === "NEEDS_RESET") return false;
    const parts = stored.split(":");
    if (parts.length !== 2) return false;
    const [salt, originalHash] = parts;
    const derived = crypto2.scryptSync(password, salt, 64).toString("hex");
    return crypto2.timingSafeEqual(Buffer.from(originalHash, "hex"), Buffer.from(derived, "hex"));
  } catch {
    return false;
  }
}
var PopocaDatabase = class {
  constructor() {
    this.db = new DatabaseSync(DB_PATH);
    this.initSchema();
    this.initStatements();
    this.migrateLegacyExample();
    this.startCleanupInterval();
  }
  initSchema() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA cache_size = -64000;
      PRAGMA temp_store = MEMORY;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        username TEXT NOT NULL,
        handle TEXT,
        avatar_url TEXT,
        banner_url TEXT,
        bio TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS user_data (
        user_id TEXT PRIMARY KEY,
        watch_history TEXT NOT NULL DEFAULT '[]',
        ratings TEXT NOT NULL DEFAULT '{}',
        watched TEXT NOT NULL DEFAULT '[]',
        watchlist TEXT NOT NULL DEFAULT '[]',
        liked TEXT NOT NULL DEFAULT '[]',
        custom_lists TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS pair_codes (
        code TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_pair_codes_expires ON pair_codes(expires_at);
      CREATE INDEX IF NOT EXISTS idx_user_data_updated ON user_data(updated_at);
    `);
  }
  initStatements() {
    this.stmtGetUserById = this.db.prepare("SELECT * FROM users WHERE id = ?");
    this.stmtGetUserByEmail = this.db.prepare("SELECT * FROM users WHERE email = ?");
    this.stmtGetSession = this.db.prepare("SELECT * FROM sessions WHERE token = ?");
    this.stmtDeleteSession = this.db.prepare("DELETE FROM sessions WHERE token = ?");
    this.stmtInsertSession = this.db.prepare(
      "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
    );
    this.stmtCleanExpiredSessions = this.db.prepare("DELETE FROM sessions WHERE expires_at < ?");
    this.stmtGetUserData = this.db.prepare("SELECT * FROM user_data WHERE user_id = ?");
    this.stmtSaveUserData = this.db.prepare(`
      INSERT OR REPLACE INTO user_data (user_id, watch_history, ratings, watched, watchlist, liked, custom_lists, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtGetPairCode = this.db.prepare("SELECT * FROM pair_codes WHERE code = ?");
    this.stmtInsertPairCode = this.db.prepare(
      "INSERT OR REPLACE INTO pair_codes (code, user_id, expires_at) VALUES (?, ?, ?)"
    );
    this.stmtDeletePairCode = this.db.prepare("DELETE FROM pair_codes WHERE code = ?");
    this.stmtCleanExpiredPairCodes = this.db.prepare("DELETE FROM pair_codes WHERE expires_at < ?");
    this.stmtUpdateProfile = this.db.prepare(`
      UPDATE users
      SET username = ?, handle = ?, bio = ?, avatar_url = ?, banner_url = ?, updated_at = ?
      WHERE id = ?
    `);
  }
  startCleanupInterval() {
    const cleanup = () => {
      try {
        const now = Date.now();
        this.stmtCleanExpiredSessions.run(now);
        this.stmtCleanExpiredPairCodes.run(now);
      } catch (err) {
        console.warn("[Database] Erro na limpeza peri\xF3dica de sess\xF5es:", err);
      }
    };
    setInterval(cleanup, 15 * 60 * 1e3).unref();
  }
  migrateLegacyExample() {
    try {
      if (!fs2.existsSync(EXAMPLE_JSON_PATH)) return;
      const countStmt = this.db.prepare("SELECT COUNT(*) as cnt FROM users");
      const row = countStmt.get();
      if (row && row.cnt > 0) return;
      const raw = fs2.readFileSync(EXAMPLE_JSON_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (!item || !item.email) continue;
        const email = String(item.email).trim().toLowerCase();
        const profile = item.profile || {};
        const id = crypto2.randomUUID();
        const now = Date.now();
        try {
          const stmt = this.db.prepare(`
            INSERT INTO users (id, email, password_hash, username, handle, avatar_url, banner_url, bio, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          stmt.run(
            id,
            email,
            "NEEDS_RESET",
            profile.username || "Cin\xE9filo Popoca",
            profile.handle || "@cinefilo",
            profile.avatarUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80",
            profile.bannerUrl || "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1600&auto=format&fit=crop&q=80",
            profile.bio || "Amante de cinema e streaming no Popoca.",
            now,
            now
          );
          this.saveDataInternal(id, {
            watch_history: item.watchHistory || [],
            ratings: item.ratings || {},
            watched: item.watched || [],
            watchlist: item.watchlist || [],
            liked: item.liked || [],
            custom_lists: item.customLists || []
          });
        } catch {
        }
      }
    } catch (err) {
      console.warn("[Database] Aviso ao inicializar dados de exemplo:", err);
    }
  }
  // ===== SESSÕES E AUTORIZAÇÃO =====
  createSession(userId) {
    const token = crypto2.randomBytes(32).toString("hex");
    const now = Date.now();
    const expiresAt = now + 30 * 24 * 60 * 60 * 1e3;
    this.stmtInsertSession.run(token, userId, now, expiresAt);
    return { token, expiresAt };
  }
  validateSession(token) {
    if (!token || typeof token !== "string") return null;
    const session = this.stmtGetSession.get(token.trim());
    if (!session) return null;
    if (Date.now() > session.expires_at) {
      this.deleteSession(token);
      return null;
    }
    return this.getUserById(session.user_id);
  }
  deleteSession(token) {
    if (!token) return;
    this.stmtDeleteSession.run(token.trim());
  }
  // ===== CONTAS E AUTENTICAÇÃO =====
  registerUser(params) {
    const email = (params.email || "").trim().toLowerCase();
    if (!email || !email.includes("@") || email.length > 254) {
      return { success: false, error: "E-mail inv\xE1lido." };
    }
    const password = typeof params.password === "string" ? params.password : "";
    if (password.length < 6) {
      return { success: false, error: "A senha deve conter no m\xEDnimo 6 caracteres." };
    }
    if (password.length > 128) {
      return { success: false, error: "A senha \xE9 muito longa (m\xE1ximo 128 caracteres)." };
    }
    const existing = this.getUserByEmail(email);
    if (existing) {
      return { success: false, error: "Uma conta com este e-mail j\xE1 existe." };
    }
    const id = crypto2.randomUUID();
    const now = Date.now();
    const hash = hashPassword(password);
    const cleanUsername = (params.username || email.split("@")[0] || "Cin\xE9filo").trim().slice(0, 50);
    const cleanHandle = (params.handle || `@${cleanUsername.toLowerCase().replace(/\s+/g, "_")}`).trim().slice(0, 30);
    try {
      const stmt = this.db.prepare(`
        INSERT INTO users (id, email, password_hash, username, handle, avatar_url, banner_url, bio, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        id,
        email,
        hash,
        cleanUsername,
        cleanHandle,
        params.avatarUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80",
        params.bannerUrl || "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1600&auto=format&fit=crop&q=80",
        params.bio || "Cin\xE9filo e maratonista no Popoca Streaming.",
        now,
        now
      );
      const initDataStmt = this.db.prepare(`
        INSERT OR IGNORE INTO user_data (user_id, watch_history, ratings, watched, watchlist, liked, custom_lists, updated_at)
        VALUES (?, '[]', '{}', '[]', '[]', '[]', '[]', ?)
      `);
      initDataStmt.run(id, now);
      const user = this.getUserById(id);
      const session = this.createSession(id);
      return { success: true, user: toSafeUser(user), token: session.token };
    } catch (err) {
      return { success: false, error: "Falha ao registrar conta. Tente novamente." };
    }
  }
  createGuestUser() {
    const id = crypto2.randomUUID();
    const shortId = id.replace(/-/g, "").slice(0, 8);
    const email = `convidado_${shortId}@popoca.guest`;
    const randomSecret = crypto2.randomBytes(32).toString("hex");
    const hash = hashPassword(randomSecret);
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO users (id, email, password_hash, username, handle, avatar_url, banner_url, bio, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      email,
      hash,
      `Convidado ${shortId}`,
      `@convidado_${shortId}`,
      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1600&auto=format&fit=crop&q=80",
      "Sess\xE3o tempor\xE1ria de convidado no Popoca.",
      now,
      now
    );
    const initDataStmt = this.db.prepare(`
      INSERT OR IGNORE INTO user_data (user_id, watch_history, ratings, watched, watchlist, liked, custom_lists, updated_at)
      VALUES (?, '[]', '{}', '[]', '[]', '[]', '[]', ?)
    `);
    initDataStmt.run(id, now);
    const user = this.getUserById(id);
    const session = this.createSession(id);
    return { success: true, user: toSafeUser(user), token: session.token };
  }
  loginUser(email, password) {
    const cleanEmail = (email || "").trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      return { success: false, error: "E-mail inv\xE1lido." };
    }
    if (!password || typeof password !== "string") {
      return { success: false, error: "Senha obrigat\xF3ria." };
    }
    const user = this.getUserByEmail(cleanEmail);
    if (!user) {
      return { success: false, error: "E-mail ou senha incorretos." };
    }
    if (user.password_hash === "NEEDS_RESET") {
      return {
        success: false,
        error: "Esta conta requer redefini\xE7\xE3o de senha para prote\xE7\xE3o dos seus dados."
      };
    }
    const match = verifyPassword(password, user.password_hash);
    if (!match) {
      return { success: false, error: "E-mail ou senha incorretos." };
    }
    const session = this.createSession(user.id);
    return { success: true, user: toSafeUser(user), token: session.token };
  }
  getUserById(id) {
    if (!id || typeof id !== "string") return null;
    const row = this.stmtGetUserById.get(id.trim());
    return row || null;
  }
  getUserByEmail(email) {
    if (!email || typeof email !== "string") return null;
    const clean = email.trim().toLowerCase();
    const row = this.stmtGetUserByEmail.get(clean);
    return row || null;
  }
  updateUserProfile(userId, updates) {
    const existing = this.getUserById(userId);
    if (!existing) return null;
    const username = updates.username !== void 0 ? updates.username.trim().slice(0, 50) : existing.username;
    const handle = updates.handle !== void 0 ? updates.handle.trim().slice(0, 30) : existing.handle;
    const bio = updates.bio !== void 0 ? updates.bio.trim().slice(0, 240) : existing.bio;
    const avatarUrl = updates.avatarUrl !== void 0 ? updates.avatarUrl.trim().slice(0, 1e3) : existing.avatar_url;
    const bannerUrl = updates.bannerUrl !== void 0 ? updates.bannerUrl.trim().slice(0, 1e3) : existing.banner_url;
    const now = Date.now();
    this.stmtUpdateProfile.run(username, handle, bio, avatarUrl, bannerUrl, now, existing.id);
    const refreshed = this.getUserById(existing.id);
    return refreshed ? toSafeUser(refreshed) : null;
  }
  // ===== DADOS DO USUÁRIO & SINCRONIZAÇÃO =====
  getUserData(userId) {
    const user = this.getUserById(userId);
    if (!user) return null;
    const row = this.stmtGetUserData.get(user.id);
    if (!row) {
      return {
        user_id: user.id,
        watch_history: [],
        ratings: {},
        watched: [],
        watchlist: [],
        liked: [],
        custom_lists: [],
        updated_at: user.updated_at
      };
    }
    try {
      return {
        user_id: user.id,
        watch_history: JSON.parse(row.watch_history || "[]"),
        ratings: JSON.parse(row.ratings || "{}"),
        watched: JSON.parse(row.watched || "[]"),
        watchlist: JSON.parse(row.watchlist || "[]"),
        liked: JSON.parse(row.liked || "[]"),
        custom_lists: JSON.parse(row.custom_lists || "[]"),
        updated_at: row.updated_at
      };
    } catch {
      return null;
    }
  }
  saveDataInternal(userId, data) {
    const now = Date.now();
    this.stmtSaveUserData.run(
      userId,
      JSON.stringify(data.watch_history || []),
      JSON.stringify(data.ratings || {}),
      JSON.stringify(data.watched || []),
      JSON.stringify(data.watchlist || []),
      JSON.stringify(data.liked || []),
      JSON.stringify(data.custom_lists || []),
      now
    );
  }
  syncUserData(userId, clientData) {
    const user = this.getUserById(userId);
    if (!user) {
      throw new Error("Usu\xE1rio n\xE3o encontrado");
    }
    if (clientData?.profile) {
      this.updateUserProfile(user.id, {
        username: clientData.profile.username,
        handle: clientData.profile.handle,
        bio: clientData.profile.bio,
        avatarUrl: clientData.profile.avatarUrl,
        bannerUrl: clientData.profile.bannerUrl
      });
    }
    const existingData = this.getUserData(user.id) || {
      user_id: user.id,
      watch_history: [],
      ratings: {},
      watched: [],
      watchlist: [],
      liked: [],
      custom_lists: [],
      updated_at: 0
    };
    const historyMap = /* @__PURE__ */ new Map();
    (existingData.watch_history || []).forEach((h) => {
      if (h && typeof h.id === "number") historyMap.set(h.id, h);
    });
    (clientData?.watchHistory || []).forEach((h) => {
      if (h && typeof h.id === "number") {
        const cur = historyMap.get(h.id);
        if (!cur || (h.lastWatched || 0) >= (cur.lastWatched || 0)) {
          historyMap.set(h.id, h);
        }
      }
    });
    const mergedHistory = Array.from(historyMap.values()).sort((a, b) => (b.lastWatched || 0) - (a.lastWatched || 0)).slice(0, 50);
    const watchedMap = /* @__PURE__ */ new Map();
    (existingData.watched || []).forEach((m) => {
      if (m?.id) watchedMap.set(m.id, m);
    });
    (clientData?.watched || []).forEach((m) => {
      if (m?.id) watchedMap.set(m.id, m);
    });
    const mergedWatched = Array.from(watchedMap.values()).slice(0, 500);
    const ratingsObj = { ...existingData.ratings };
    if (clientData?.ratings && typeof clientData.ratings === "object") {
      Object.entries(clientData.ratings).forEach(([id, r]) => {
        if (!ratingsObj[id] || (r.watchedDate || 0) >= (ratingsObj[id]?.watchedDate || 0)) {
          ratingsObj[id] = r;
        }
      });
    }
    const likedMap = /* @__PURE__ */ new Map();
    (existingData.liked || []).forEach((m) => {
      if (m?.id) likedMap.set(m.id, m);
    });
    (clientData?.liked || []).forEach((m) => {
      if (m?.id) likedMap.set(m.id, m);
    });
    const mergedLiked = Array.from(likedMap.values()).slice(0, 500);
    const watchlistMap = /* @__PURE__ */ new Map();
    (existingData.watchlist || []).forEach((m) => {
      if (m?.id) watchlistMap.set(m.id, m);
    });
    (clientData?.watchlist || []).forEach((m) => {
      if (m?.id) watchlistMap.set(m.id, m);
    });
    const mergedWatchlist = Array.from(watchlistMap.values()).slice(0, 500);
    const listMap = /* @__PURE__ */ new Map();
    (existingData.custom_lists || []).forEach((l) => {
      if (l?.id) listMap.set(l.id, l);
    });
    (clientData?.customLists || []).forEach((l) => {
      if (l?.id) {
        const curList = listMap.get(l.id);
        if (!curList) {
          listMap.set(l.id, l);
        } else {
          const itemMap = /* @__PURE__ */ new Map();
          (curList.items || []).forEach((it) => {
            if (it?.id) itemMap.set(it.id, it);
          });
          (l.items || []).forEach((it) => {
            if (it?.id) itemMap.set(it.id, it);
          });
          listMap.set(l.id, { ...curList, ...l, items: Array.from(itemMap.values()) });
        }
      }
    });
    const mergedLists = Array.from(listMap.values()).slice(0, 50);
    this.saveDataInternal(user.id, {
      watch_history: mergedHistory,
      ratings: ratingsObj,
      watched: mergedWatched,
      watchlist: mergedWatchlist,
      liked: mergedLiked,
      custom_lists: mergedLists
    });
    const refreshedUser = this.getUserById(user.id) || user;
    return {
      userId: refreshedUser.id,
      email: refreshedUser.email,
      lastUpdated: Date.now(),
      watchHistory: mergedHistory,
      ratings: ratingsObj,
      watched: mergedWatched,
      watchlist: mergedWatchlist,
      liked: mergedLiked,
      customLists: mergedLists,
      profile: {
        username: refreshedUser.username,
        handle: refreshedUser.handle,
        bio: refreshedUser.bio,
        avatarUrl: refreshedUser.avatar_url,
        bannerUrl: refreshedUser.banner_url,
        joinedAt: refreshedUser.created_at
      }
    };
  }
  // ===== PAREAMENTO POR CÓDIGO (CROSS-DEVICE) =====
  generatePairCode(userId) {
    const user = this.getUserById(userId);
    if (!user) throw new Error("Usu\xE1rio inv\xE1lido para pareamento");
    const code = Math.floor(1e5 + Math.random() * 9e5).toString();
    const formatted = `${code.slice(0, 3)}-${code.slice(3)}`;
    const expiresAt = Date.now() + 15 * 60 * 1e3;
    this.stmtInsertPairCode.run(formatted, user.id, expiresAt);
    return formatted;
  }
  redeemPairCode(code) {
    const clean = code.trim().replace(/\s+/g, "");
    const formatted = clean.length === 6 ? `${clean.slice(0, 3)}-${clean.slice(3)}` : clean;
    const row = this.stmtGetPairCode.get(formatted);
    if (!row) return null;
    if (Date.now() > row.expires_at) {
      this.stmtDeletePairCode.run(formatted);
      return null;
    }
    const user = this.getUserById(row.user_id);
    if (!user) return null;
    this.stmtDeletePairCode.run(formatted);
    const session = this.createSession(user.id);
    const data = this.getUserData(user.id);
    return {
      user: toSafeUser(user),
      token: session.token,
      data: {
        userId: user.id,
        email: user.email,
        lastUpdated: user.updated_at,
        watchHistory: data?.watch_history || [],
        ratings: data?.ratings || {},
        watched: data?.watched || [],
        watchlist: data?.watchlist || [],
        liked: data?.liked || [],
        customLists: data?.custom_lists || [],
        profile: {
          username: user.username,
          handle: user.handle,
          bio: user.bio,
          avatarUrl: user.avatar_url,
          bannerUrl: user.banner_url,
          joinedAt: user.created_at
        }
      }
    };
  }
  ping() {
    try {
      const row = this.db.prepare("SELECT 1 AS ok").get();
      return row?.ok === 1;
    } catch {
      return false;
    }
  }
};
var db = new PopocaDatabase();

// server/syncService.ts
var CloudSyncService = class {
  normalizeId(id) {
    return (id || "").trim().toLowerCase();
  }
  getUser(userId) {
    const user = db.getUserById(userId);
    if (!user) return null;
    const data = db.getUserData(user.id);
    return {
      userId: user.id,
      email: user.email,
      lastUpdated: user.updated_at,
      watchHistory: data?.watch_history || [],
      ratings: data?.ratings || {},
      watched: data?.watched || [],
      watchlist: data?.watchlist || [],
      liked: data?.liked || [],
      customLists: data?.custom_lists || [],
      profile: {
        username: user.username,
        handle: user.handle,
        bio: user.bio,
        avatarUrl: user.avatar_url,
        bannerUrl: user.banner_url,
        joinedAt: user.created_at
      }
    };
  }
  syncUserData(userId, clientData) {
    return db.syncUserData(userId, clientData);
  }
  generatePairCode(userId) {
    return db.generatePairCode(userId);
  }
  redeemPairCode(code) {
    return db.redeemPairCode(code);
  }
};
var syncService = new CloudSyncService();

// server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path3.dirname(__filename);
process.on("uncaughtException", (err) => {
  console.error("[Popoca CRITICAL] Erro n\xE3o tratado no processo:", {
    message: err?.message,
    stack: err?.stack,
    time: (/* @__PURE__ */ new Date()).toISOString()
  });
});
process.on("unhandledRejection", (reason) => {
  console.error("[Popoca WARN] Promessa rejeitada n\xE3o tratada:", {
    reason: reason?.message || reason,
    time: (/* @__PURE__ */ new Date()).toISOString()
  });
});
torrentEngine.pruneDiskCache();
function getLocalLanIp() {
  try {
    const nets = os2.networkInterfaces();
    const candidates = [];
    for (const [name, entries] of Object.entries(nets)) {
      if (!entries) continue;
      if (/(wsl|vethernet|virtualbox|vmware|docker|hyper-v|loopback|tailscale|zerotier|hamachi)/i.test(name)) {
        continue;
      }
      for (const net of entries) {
        if (String(net.family) !== "IPv4" || net.internal || !net.address) continue;
        if (net.address.startsWith("169.254.")) continue;
        let priority = 3;
        if (net.address.startsWith("192.168.")) priority = 1;
        else if (net.address.startsWith("10.")) priority = 2;
        else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(net.address)) priority = 2;
        if (/(wi-?fi|wlan|wireless|ethernet|eth)/i.test(name)) {
          priority -= 0.5;
        }
        candidates.push({ address: net.address, priority });
      }
    }
    candidates.sort((a, b) => a.priority - b.priority);
    if (candidates.length > 0) {
      return candidates[0].address;
    }
  } catch {
  }
  return "127.0.0.1";
}
function escapeHtmlAttr(raw) {
  return raw.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function parsePriorityMode(val) {
  if (val === "pt-br-stability" || val === "ultra-speed" || val === "global-balanced") {
    return val;
  }
  return void 0;
}
function parseSafeInt(val, fallback, min, max) {
  const n = typeof val === "number" ? Math.floor(val) : parseInt(String(val), 10);
  if (isNaN(n) || !Number.isFinite(n)) return fallback;
  if (min !== void 0 && n < min) return min;
  if (max !== void 0 && n > max) return max;
  return n;
}
function parseSafeFloat(val, fallback, min, max) {
  const n = typeof val === "number" ? val : parseFloat(String(val));
  if (isNaN(n) || !Number.isFinite(n)) return fallback;
  if (min !== void 0 && n < min) return min;
  if (max !== void 0 && n > max) return max;
  return n;
}
var STRICT_MAGNET_REGEX = /^magnet:\?(?:[^&\s]*&)*xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})(?:[&#]|$)/i;
var MAX_MAGNET_LENGTH = 4096;
function validateMagnet(magnet) {
  if (typeof magnet !== "string" || !magnet.trim()) {
    return { valid: false, error: "Magnet URI ausente." };
  }
  const clean = magnet.trim();
  if (clean.length > MAX_MAGNET_LENGTH) {
    return { valid: false, error: `Magnet URI excede o limite de seguran\xE7a (${MAX_MAGNET_LENGTH} caracteres).` };
  }
  if (!clean.startsWith("magnet:?")) {
    return { valid: false, error: "Formato inv\xE1lido de link Magnet (deve iniciar com magnet:?)." };
  }
  if (!STRICT_MAGNET_REGEX.test(clean)) {
    return { valid: false, error: "Magnet URI n\xE3o cont\xE9m um infoHash BTIH v\xE1lido (xt=urn:btih:)." };
  }
  return { valid: true };
}
function sendSafeError(res, status, userMessage, internalError) {
  if (res.headersSent) return;
  if (internalError) {
    console.error(`[Popoca HTTP ${status}]`, internalError?.message || internalError);
  }
  const error = process.env.NODE_ENV === "production" ? userMessage : internalError?.message || userMessage;
  res.status(status).json({ success: false, error });
}
var ALLOWED_IMAGE_HOSTS = /* @__PURE__ */ new Set([
  "image.tmdb.org",
  "images.metahub.space",
  "images.unsplash.com",
  "avatars.githubusercontent.com",
  "m.media-amazon.com",
  "img.youtube.com"
]);
function isPrivateIp(ip) {
  if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) || ip.startsWith("fc00:") || ip.startsWith("fe80:") || ip === "0.0.0.0") {
    return true;
  }
  return false;
}
async function validateSafeHttpsUrl(rawUrl, allowedHosts) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") {
      return { valid: false, error: "Apenas conex\xF5es HTTPS s\xE3o permitidas." };
    }
    if (allowedHosts && !allowedHosts.has(parsed.hostname.toLowerCase())) {
      return { valid: false, error: `Host n\xE3o autorizado no proxy: ${parsed.hostname}` };
    }
    const lookup = await dns.promises.lookup(parsed.hostname);
    if (isPrivateIp(lookup.address)) {
      return { valid: false, error: "Destino inv\xE1lido (endere\xE7o IP privado ou reservado)." };
    }
    return { valid: true, url: parsed };
  } catch (err) {
    return { valid: false, error: "URL inv\xE1lida ou inalcan\xE7\xE1vel." };
  }
}
function createRateLimiter(windowMs, maxRequests, message) {
  const ipMap = /* @__PURE__ */ new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, b] of ipMap.entries()) {
      if (now > b.resetAt) ipMap.delete(ip);
    }
  }, 5 * 60 * 1e3).unref();
  return (req, res, next) => {
    const rawIp = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1");
    const ip = rawIp.split(",")[0].trim();
    const now = Date.now();
    let bucket = ipMap.get(ip);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 1, resetAt: now + windowMs };
      ipMap.set(ip, bucket);
      return next();
    }
    bucket.count++;
    if (bucket.count > maxRequests) {
      res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1e3));
      return res.status(429).json({
        success: false,
        error: "RATE_LIMIT_EXCEEDED",
        message
      });
    }
    next();
  };
}
var authLimiter = createRateLimiter(60 * 1e3, 30, "Muitas tentativas de autentica\xE7\xE3o. Aguarde um minuto.");
var rawStreamLimiter = createRateLimiter(60 * 1e3, 600, "Muitas requisi\xE7\xF5es de reprodu\xE7\xE3o simult\xE2neas.");
var streamLimiter = (req, res, next) => {
  const range = req.headers.range;
  if (typeof range === "string" && range.startsWith("bytes=") && !range.startsWith("bytes=0-")) {
    return next();
  }
  return rawStreamLimiter(req, res, next);
};
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error: "UNAUTHORIZED",
      message: "Autentica\xE7\xE3o necess\xE1ria. Envie o cabe\xE7alho Authorization: Bearer <token>."
    });
  }
  const token = authHeader.slice(7).trim();
  const user = db.validateSession(token);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: "INVALID_TOKEN",
      message: "Sess\xE3o inv\xE1lida ou expirada. Fa\xE7a login novamente."
    });
  }
  req.user = user;
  next();
}
var responseCache = /* @__PURE__ */ new Map();
var inflightRequests = /* @__PURE__ */ new Map();
var RESPONSE_CACHE_MAX = 800;
async function cachedFetch(key, ttlMs, loader, shouldCache = () => true) {
  const hit = responseCache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) {
    return hit.value;
  }
  const pending = inflightRequests.get(key);
  if (pending) return pending;
  const p = (async () => {
    try {
      const value = await loader();
      if (shouldCache(value)) {
        if (responseCache.size >= RESPONSE_CACHE_MAX) {
          const oldestKey = responseCache.keys().next().value;
          if (oldestKey !== void 0) responseCache.delete(oldestKey);
        }
        responseCache.set(key, { at: Date.now(), ttl: ttlMs, value });
      }
      return value;
    } catch (err) {
      if (hit) return hit.value;
      throw err;
    } finally {
      inflightRequests.delete(key);
    }
  })();
  inflightRequests.set(key, p);
  return p;
}
var MIN = 60 * 1e3;
async function bootstrap() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3e3;
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" }
    })
  );
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim().toLowerCase()) : [];
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const lower = origin.toLowerCase();
        if (lower === "https://popocas.vercel.app" || lower.endsWith(".vercel.app") || lower.startsWith("http://localhost:") || lower.startsWith("http://127.0.0.1:") || lower.startsWith("http://192.168.") || lower.startsWith("http://10.") || lower.startsWith("https://ais-") || allowedOriginsEnv.includes(lower)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
      exposedHeaders: [
        "X-Popoca-Stream-Mode",
        "X-Popoca-Active-Hash",
        "X-Popoca-Audio-Hash",
        "X-Popoca-Real-Lang",
        "X-Popoca-Quality-Fallback",
        "X-Popoca-Fallback-Message",
        "Content-Range",
        "Accept-Ranges"
      ]
    })
  );
  app.use(
    compression({
      filter: (req, res) => {
        const contentType = res.getHeader("Content-Type");
        if (typeof contentType === "string" && (contentType.startsWith("video/") || contentType.startsWith("audio/"))) {
          return false;
        }
        if (req.url.startsWith("/api/torrent/stream") || req.url.startsWith("/api/stream") || req.url.startsWith("/api/proxy-image")) {
          return false;
        }
        if (req.headers["x-no-compression"] || req.headers.accept === "text/event-stream") {
          return false;
        }
        return compression.filter(req, res);
      },
      threshold: 1024
    })
  );
  app.use(express.json({ limit: "2mb" }));
  app.use((req, _res, next) => {
    if (req.url.startsWith("/api/") && !/^\/api\/(torrent\/stats|stream\/stats|stats|network)/.test(req.url)) {
      const remoteIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || req.ip;
      console.log(`[Rede Popoca] ${req.method} ${req.url.slice(0, 140)} de ${remoteIp}`);
    }
    next();
  });
  app.post("/api/auth/register", authLimiter, (req, res) => {
    try {
      const { email, password, username, handle, avatarUrl, bannerUrl, bio } = req.body || {};
      const result = db.registerUser({ email, password, username, handle, avatarUrl, bannerUrl, bio });
      if (!result.success) {
        res.status(400).json(result);
        return;
      }
      res.json({ success: true, user: result.user, token: result.token });
    } catch (err) {
      sendSafeError(res, 500, "Erro ao criar conta.", err);
    }
  });
  app.post("/api/auth/login", authLimiter, (req, res) => {
    try {
      const { email, password } = req.body || {};
      const result = db.loginUser(email, password);
      if (!result.success) {
        res.status(401).json(result);
        return;
      }
      res.json({ success: true, user: result.user, token: result.token });
    } catch (err) {
      sendSafeError(res, 500, "Erro ao realizar login.", err);
    }
  });
  app.post("/api/auth/guest", authLimiter, (_req, res) => {
    try {
      const guest = db.createGuestUser();
      res.json(guest);
    } catch (err) {
      sendSafeError(res, 500, "Erro ao criar sess\xE3o de convidado.", err);
    }
  });
  app.get("/api/auth/me", requireAuth, (req, res) => {
    res.json({ success: true, user: toSafeUser(req.user) });
  });
  app.post("/api/auth/logout", requireAuth, (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      db.deleteSession(authHeader.slice(7).trim());
    }
    res.json({ success: true, message: "Sess\xE3o encerrada com sucesso." });
  });
  app.put("/api/auth/profile", requireAuth, (req, res) => {
    try {
      const { username, handle, bio, avatarUrl, bannerUrl } = req.body || {};
      const updated = db.updateUserProfile(req.user.id, { username, handle, bio, avatarUrl, bannerUrl });
      if (!updated) {
        res.status(404).json({ success: false, error: "Usu\xE1rio n\xE3o encontrado" });
        return;
      }
      res.json({ success: true, user: updated });
    } catch (err) {
      sendSafeError(res, 500, "Erro ao atualizar perfil.", err);
    }
  });
  app.get("/api/sync", requireAuth, (req, res) => {
    try {
      const userSync = syncService.getUser(req.user.id);
      res.json({ success: true, exists: true, data: userSync });
    } catch (err) {
      sendSafeError(res, 500, "Erro ao recuperar dados da nuvem.", err);
    }
  });
  app.post("/api/sync", requireAuth, (req, res) => {
    try {
      const { clientData } = req.body || {};
      const merged = syncService.syncUserData(req.user.id, clientData || {});
      res.json({ success: true, data: merged });
    } catch (err) {
      sendSafeError(res, 500, "Erro ao sincronizar dados.", err);
    }
  });
  app.post("/api/sync/pair-code", requireAuth, authLimiter, (req, res) => {
    try {
      const code = syncService.generatePairCode(req.user.id);
      res.json({ success: true, code, expiresInMinutes: 15 });
    } catch (err) {
      sendSafeError(res, 500, "Erro ao gerar c\xF3digo de pareamento.", err);
    }
  });
  app.post("/api/sync/pair-code/redeem", authLimiter, (req, res) => {
    try {
      const { code } = req.body || {};
      if (!code || typeof code !== "string") {
        res.status(400).json({ success: false, error: "C\xF3digo de pareamento obrigat\xF3rio" });
        return;
      }
      const redeemed = syncService.redeemPairCode(code);
      if (!redeemed) {
        res.status(404).json({ success: false, error: "C\xF3digo de pareamento inv\xE1lido ou expirado." });
        return;
      }
      res.json({ success: true, token: redeemed.token, user: redeemed.user, data: redeemed.data });
    } catch (err) {
      sendSafeError(res, 500, "Erro ao vincular dispositivo.", err);
    }
  });
  app.get("/api/catalog", async (req, res) => {
    try {
      const category = req.query.category || "trending";
      const page = parseSafeInt(req.query.page, 1, 1, 100);
      const items = await cachedFetch(
        `catalog|${category}|${page}`,
        30 * MIN,
        () => tmdbService.getCatalog(category, page),
        (v) => Array.isArray(v) && v.length > 0
      );
      res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=1800");
      res.json({ success: true, category, items });
    } catch (err) {
      sendSafeError(res, 500, "Erro ao carregar cat\xE1logo.", err);
    }
  });
  app.get("/api/search", async (req, res) => {
    try {
      const q = String(req.query.q || "").slice(0, 100);
      const results = await cachedFetch(
        `search|${q.trim().toLowerCase()}`,
        10 * MIN,
        () => tmdbService.search(q),
        (v) => Array.isArray(v) && v.length > 0
      );
      res.json({ success: true, count: results.length, results });
    } catch (err) {
      sendSafeError(res, 500, "Erro ao buscar t\xEDtulos.", err);
    }
  });
  app.get("/api/search/suggestions", async (req, res) => {
    try {
      const q = String(req.query.q || "").slice(0, 100);
      const suggestions = await tmdbService.getSuggestions(q);
      res.json({ success: true, suggestions });
    } catch (err) {
      sendSafeError(res, 500, "Erro ao buscar sugest\xF5es.", err);
    }
  });
  app.get("/api/details/:id", async (req, res) => {
    try {
      const id = parseSafeInt(req.params.id, 0, 1);
      if (!id) {
        res.status(400).json({ success: false, error: "ID inv\xE1lido." });
        return;
      }
      const type = req.query.type || "movie";
      const details = await cachedFetch(
        `details|${type}|${id}`,
        6 * 60 * MIN,
        () => tmdbService.getDetails(id, type),
        (v) => Boolean(v)
      );
      if (!details) {
        res.status(404).json({ success: false, error: "T\xEDtulo n\xE3o encontrado" });
        return;
      }
      res.json({ success: true, details });
    } catch (err) {
      sendSafeError(res, 500, "Erro ao carregar detalhes.", err);
    }
  });
  app.get("/api/series/:id/season/:seasonNumber", async (req, res) => {
    try {
      const id = parseSafeInt(req.params.id, 0, 1);
      const seasonNumber = parseSafeInt(req.params.seasonNumber, 1, 1, 100);
      if (!id) {
        res.status(400).json({ success: false, error: "ID da s\xE9rie inv\xE1lido." });
        return;
      }
      const episodes = await cachedFetch(
        `season|${id}|${seasonNumber}`,
        6 * 60 * MIN,
        () => tmdbService.getSeasonEpisodes(id, seasonNumber),
        (v) => Array.isArray(v) && v.length > 0
      );
      res.json({ success: true, seriesId: id, seasonNumber, episodes });
    } catch (err) {
      sendSafeError(res, 500, "Erro ao buscar epis\xF3dios.", err);
    }
  });
  app.get("/api/torrents", async (req, res) => {
    try {
      const title = String(req.query.title || "").slice(0, 140);
      const originalTitle = req.query.originalTitle ? String(req.query.originalTitle).slice(0, 140) : void 0;
      const year = req.query.year ? String(req.query.year).slice(0, 4) : void 0;
      let imdbId = req.query.imdbId ? String(req.query.imdbId).slice(0, 20) : void 0;
      const tmdbId = req.query.tmdbId ? parseSafeInt(req.query.tmdbId, 0, 1) : 0;
      const mediaType = req.query.mediaType || "movie";
      const season = req.query.season ? parseSafeInt(req.query.season, 1, 1, 100) : void 0;
      const episode = req.query.episode ? parseSafeInt(req.query.episode, 1, 1, 1e3) : void 0;
      const trackerPriority = parsePriorityMode(req.query.trackerPriority);
      if (!imdbId && tmdbId > 0) {
        try {
          const details = await tmdbService.getDetails(tmdbId, mediaType);
          if (details?.imdb_id) {
            imdbId = details.imdb_id;
          }
        } catch {
        }
      }
      if (!title && !imdbId) {
        res.status(400).json({ success: false, error: "Par\xE2metro title ou imdbId \xE9 obrigat\xF3rio" });
        return;
      }
      const torrents = await cachedFetch(
        `torrents|${imdbId || ""}|${title}|${year || ""}|${mediaType}|${season ?? ""}|${episode ?? ""}|${trackerPriority || ""}`,
        20 * MIN,
        () => indexerService.findTorrents({
          title,
          originalTitle,
          year,
          imdbId,
          mediaType,
          season,
          episode,
          trackerPriority
        }),
        (v) => Array.isArray(v) && v.length > 0
      );
      res.json({
        success: true,
        count: torrents.length,
        trackerPriority: trackerPriority || indexerService.getTrackerPriority(),
        torrents
      });
    } catch (err) {
      sendSafeError(res, 500, "Erro ao indexar torrents.", err);
    }
  });
  app.get("/api/torrent/tracker-priority", (_req, res) => {
    res.json({
      success: true,
      trackerPriority: torrentEngine.getTrackerPriority()
    });
  });
  app.post("/api/torrent/tracker-priority", (req, res) => {
    const mode = parsePriorityMode(req.body?.trackerPriority);
    const magnet = req.body?.magnet;
    if (!mode) {
      res.status(400).json({ success: false, error: "Modo de prioridade de tracker inv\xE1lido" });
      return;
    }
    if (magnet) {
      const magCheck = validateMagnet(magnet);
      if (!magCheck.valid) {
        res.status(400).json({ success: false, error: magCheck.error });
        return;
      }
    }
    indexerService.setTrackerPriority(mode);
    torrentEngine.setTrackerPriority(mode, magnet);
    res.json({ success: true, trackerPriority: mode });
  });
  app.post("/api/torrent/retry", async (req, res) => {
    try {
      const magnet = req.body?.magnet;
      const trackerPriority = parsePriorityMode(req.body?.trackerPriority);
      const magCheck = validateMagnet(magnet);
      if (!magCheck.valid) {
        res.status(400).json({ success: false, error: magCheck.error });
        return;
      }
      const result = await torrentEngine.forceRetryPeers(magnet, trackerPriority);
      res.json(result);
    } catch (err) {
      sendSafeError(res, 500, "Erro ao reconectar aos peers.", err);
    }
  });
  app.get("/api/stream/hybrid", streamLimiter, async (req, res) => {
    try {
      const videoMagnet = req.query.videoMagnet;
      const audioMagnet = req.query.audioMagnet;
      const vCheck = validateMagnet(videoMagnet);
      if (!vCheck.valid) {
        res.status(400).json({ success: false, error: `videoMagnet inv\xE1lido: ${vCheck.error}` });
        return;
      }
      const aCheck = validateMagnet(audioMagnet);
      if (!aCheck.valid) {
        res.status(400).json({ success: false, error: `audioMagnet inv\xE1lido: ${aCheck.error}` });
        return;
      }
      const seekSeconds = req.query.seek ? parseSafeFloat(req.query.seek, 0, 0, 86400) : void 0;
      const audioDelayMs = req.query.audioDelayMs ? parseSafeFloat(req.query.audioDelayMs, 0, -2e3, 2e3) : void 0;
      const trackerPriority = parsePriorityMode(req.query.trackerPriority);
      const season = req.query.season ? parseSafeInt(req.query.season, 1, 1, 100) : void 0;
      const episode = req.query.episode ? parseSafeInt(req.query.episode, 1, 1, 1e3) : void 0;
      await torrentEngine.handleHybridStreamRequest(req, res, videoMagnet, audioMagnet, {
        seekSeconds,
        audioDelayMs,
        trackerPriority,
        season,
        episode
      });
    } catch (err) {
      if (!res.headersSent) {
        sendSafeError(res, 503, "N\xE3o foi poss\xEDvel iniciar o Muxing H\xEDbrido em tempo real.", err);
      }
    }
  });
  app.get("/api/stream/:tmdbId", streamLimiter, async (req, res) => {
    try {
      const tmdbId = parseSafeInt(req.params.tmdbId, 0, 1);
      if (!tmdbId) {
        res.status(400).json({ success: false, error: "ID TMDB inv\xE1lido." });
        return;
      }
      const mediaType = req.query.mediaType || "movie";
      const season = req.query.season ? parseSafeInt(req.query.season, 1, 1, 100) : void 0;
      const episode = req.query.episode ? parseSafeInt(req.query.episode, 1, 1, 1e3) : void 0;
      const preferredQuality = req.query.quality;
      const trackerPriority = parsePriorityMode(req.query.trackerPriority);
      const transcode = req.query.transcode === "true";
      const audioOnly = req.query.audioOnly === "true";
      const seekSeconds = req.query.seek ? parseSafeFloat(req.query.seek, 0, 0, 86400) : void 0;
      const preferPortugueseAudio = req.query.preferPt !== "false";
      const audioTrackIndex = req.query.audioTrack !== void 0 ? parseSafeInt(req.query.audioTrack, 0, 0, 20) : void 0;
      const media = await tmdbService.getDetails(tmdbId, mediaType);
      if (!media) {
        res.status(404).send("T\xEDtulo TMDB n\xE3o encontrado.");
        return;
      }
      const year = media.release_date ? media.release_date.slice(0, 4) : void 0;
      const torrents = await indexerService.findTorrents({
        title: media.title,
        originalTitle: media.original_title,
        year,
        imdbId: media.imdb_id,
        mediaType: media.media_type,
        season,
        episode,
        trackerPriority
      });
      const {
        requestedQuality,
        primaryCandidates,
        fallbackCandidates,
        fallbackQuality
      } = selectQualityCappedCandidates(torrents, preferredQuality, preferPortugueseAudio);
      const topCandidates = primaryCandidates.slice(0, 3);
      const bestFallback = fallbackCandidates[0];
      for (let idx = 0; idx < topCandidates.length; idx++) {
        const candidate = topCandidates[idx];
        const isLastPrimary = idx === topCandidates.length - 1;
        try {
          await torrentEngine.handleStreamRequest(
            req,
            res,
            candidate.magnetUri,
            transcode,
            audioOnly,
            trackerPriority,
            {
              seekSeconds,
              preferPortugueseAudio,
              audioTrackIndex,
              season,
              episode,
              fileIdx: candidate.fileIdx,
              preferredQuality: requestedQuality,
              fallbackMagnet: isLastPrimary ? bestFallback?.magnetUri : void 0,
              fallbackQuality: isLastPrimary ? fallbackQuality || void 0 : void 0,
              fallbackFileIdx: isLastPrimary ? bestFallback?.fileIdx : void 0,
              hasAlternatives: !isLastPrimary || Boolean(bestFallback)
            }
          );
          return;
        } catch (err) {
          if (err?.message === "SERVER_CAPACITY_REACHED") {
            res.status(429).json({
              success: false,
              error: "SERVER_CAPACITY_REACHED",
              message: "Limite de reprodu\xE7\xF5es simult\xE2neas atingido no servidor. Tente novamente em instantes."
            });
            return;
          }
          if (res.headersSent) return;
        }
      }
      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          error: "TORRENT_STREAM_UNAVAILABLE",
          message: "A fonte P2P selecionada n\xE3o possui sementes ativas no momento. Use o bot\xE3o Re-try no Painel de Rede ou selecione outra op\xE7\xE3o."
        });
      }
    } catch (err) {
      sendSafeError(res, 500, "Erro ao processar stream TMDB.", err);
    }
  });
  app.get("/api/stream", streamLimiter, async (req, res) => {
    const magnet = req.query.magnet;
    const magCheck = validateMagnet(magnet);
    if (!magCheck.valid) {
      res.status(400).json({ success: false, error: magCheck.error });
      return;
    }
    const altMagnetsRaw = req.query.altMagnets;
    const fallbackMagnetRaw = req.query.fallbackMagnet;
    const fallbackQuality = req.query.fallbackQuality ? normalizeQuality(String(req.query.fallbackQuality)) : void 0;
    const preferredQuality = req.query.quality ? normalizeQuality(String(req.query.quality)) : void 0;
    const trackerPriority = parsePriorityMode(req.query.trackerPriority);
    const transcode = req.query.transcode === "true";
    const audioOnly = req.query.audioOnly === "true";
    const seekSeconds = req.query.seek ? parseSafeFloat(req.query.seek, 0, 0, 86400) : void 0;
    const preferPortugueseAudio = req.query.preferPt !== "false";
    const audioTrackIndex = req.query.audioTrack !== void 0 ? parseSafeInt(req.query.audioTrack, 0, 0, 20) : void 0;
    const season = req.query.season ? parseSafeInt(req.query.season, 1, 1, 100) : void 0;
    const episode = req.query.episode ? parseSafeInt(req.query.episode, 1, 1, 1e3) : void 0;
    const fileIdx = req.query.fileIdx ? parseSafeInt(req.query.fileIdx, 0, 0, 500) : void 0;
    const validFallbackMagnet = fallbackMagnetRaw && validateMagnet(fallbackMagnetRaw).valid ? fallbackMagnetRaw : void 0;
    const magnetsToTry = [magnet];
    if (altMagnetsRaw) {
      try {
        const alts = JSON.parse(altMagnetsRaw);
        if (Array.isArray(alts)) {
          alts.forEach((m) => {
            if (typeof m === "string" && validateMagnet(m).valid && !magnetsToTry.includes(m)) {
              magnetsToTry.push(m);
            }
          });
        }
      } catch {
      }
    }
    for (let i = 0; i < magnetsToTry.length; i++) {
      const currentMagnet = magnetsToTry[i];
      const isLastSameQuality = i === magnetsToTry.length - 1;
      try {
        await torrentEngine.handleStreamRequest(
          req,
          res,
          currentMagnet,
          transcode,
          audioOnly,
          trackerPriority,
          {
            seekSeconds,
            preferPortugueseAudio,
            audioTrackIndex,
            season,
            episode,
            fileIdx: i === 0 ? fileIdx : void 0,
            preferredQuality,
            fallbackMagnet: isLastSameQuality ? validFallbackMagnet : void 0,
            fallbackQuality: isLastSameQuality ? fallbackQuality || "720p" : void 0,
            hasAlternatives: !isLastSameQuality || Boolean(validFallbackMagnet)
          }
        );
        return;
      } catch (err) {
        if (err?.message === "SERVER_CAPACITY_REACHED") {
          res.status(429).json({
            success: false,
            error: "SERVER_CAPACITY_REACHED",
            message: "Limite de reprodu\xE7\xF5es simult\xE2neas atingido no servidor. Tente novamente em instantes."
          });
          return;
        }
        if (res.headersSent) return;
      }
    }
    if (!res.headersSent) {
      res.status(503).json({
        success: false,
        error: "TORRENT_STREAM_UNAVAILABLE",
        message: "N\xE3o foi poss\xEDvel estabelecer conex\xE3o com o enxame deste torrent no momento. For\xE7e um Re-try de peers ou selecione outra fonte."
      });
    }
  });
  app.get("/api/torrent/stats", (req, res) => {
    const magnet = req.query.magnet;
    const magCheck = validateMagnet(magnet);
    if (!magCheck.valid) {
      res.status(400).json({ error: magCheck.error });
      return;
    }
    const stats = torrentEngine.getStats(magnet);
    res.json({ success: true, stats });
  });
  app.get("/api/torrent/stats/:hash", (req, res) => {
    const hash = req.params.hash;
    if (!hash || !/^[a-fA-F0-9]{40}$/.test(hash)) {
      res.status(400).json({ error: "Hash hexadecimal de 40 caracteres inv\xE1lido." });
      return;
    }
    const stats = torrentEngine.getStats(hash);
    res.json({ success: true, stats });
  });
  app.post("/api/torrent/upload", express.json({ limit: "10mb" }), (req, res) => {
    try {
      const { torrentData, fileName } = req.body || {};
      if (!torrentData || typeof torrentData !== "string") {
        res.status(400).json({ success: false, error: "Dados do arquivo .torrent ausentes." });
        return;
      }
      const buf = Buffer.from(torrentData, "base64");
      const parsed = parseTorrentBuffer(buf);
      if (!parsed.valid || !parsed.magnetUri) {
        res.status(400).json({ success: false, error: parsed.error || "Arquivo .torrent inv\xE1lido." });
        return;
      }
      res.json({
        success: true,
        infoHash: parsed.infoHash,
        name: parsed.name || fileName || "V\xEDdeo Torrent",
        magnetUri: parsed.magnetUri
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || "Erro ao processar arquivo .torrent." });
    }
  });
  app.get("/api/torrent/preload", async (req, res) => {
    const magnet = req.query.magnet;
    const magCheck = validateMagnet(magnet);
    if (!magCheck.valid) {
      res.status(400).json({ error: magCheck.error });
      return;
    }
    const trackerPriority = parsePriorityMode(req.query.trackerPriority);
    const season = req.query.season ? parseSafeInt(req.query.season, 1, 1, 100) : void 0;
    const episode = req.query.episode ? parseSafeInt(req.query.episode, 1, 1, 1e3) : void 0;
    const fileIdx = req.query.fileIdx !== void 0 ? parseSafeInt(req.query.fileIdx, 0, 0, 500) : void 0;
    torrentEngine.preload(magnet, trackerPriority, { season, episode, fileIdx }).catch(() => {
    });
    res.json({ success: true, status: "preloading_initiated" });
  });
  app.get("/api/torrent/prefetch", (req, res) => {
    const magnet = req.query.magnet;
    const magCheck = validateMagnet(magnet);
    if (!magCheck.valid) {
      res.status(400).json({ error: magCheck.error });
      return;
    }
    const currentTime = parseSafeFloat(req.query.currentTime, 0, 0, 86400);
    const duration = parseSafeFloat(req.query.duration, 7200, 1, 86400);
    const speed = parseSafeFloat(req.query.speed, 1024 * 1024 * 2, 100, 100 * 1024 * 1024);
    const result = torrentEngine.prefetchNextPieces(magnet, currentTime, duration, speed);
    res.json(result);
  });
  app.get("/api/subtitles/list", async (req, res) => {
    try {
      const imdbId = String(req.query.imdbId || "").slice(0, 20);
      const mediaType = req.query.mediaType || "movie";
      const season = req.query.season ? parseSafeInt(req.query.season, 1, 1, 100) : void 0;
      const episode = req.query.episode ? parseSafeInt(req.query.episode, 1, 1, 1e3) : void 0;
      const fileName = req.query.fileName ? String(req.query.fileName).slice(0, 255) : void 0;
      const tracks = await subtitleService.listTracks({
        imdbId,
        type: mediaType === "movie" ? "movie" : "series",
        season,
        episode,
        fileName
      });
      res.json({ success: true, tracks });
    } catch (err) {
      res.status(500).json({ success: false, error: "Erro ao listar legendas", tracks: [] });
    }
  });
  app.get("/api/subtitles/vtt", async (req, res) => {
    const id = String(req.query.id || "").slice(0, 120);
    const vtt = await subtitleService.getVtt(id);
    if (!vtt) {
      res.status(404).send("Legenda indispon\xEDvel");
      return;
    }
    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(vtt);
  });
  app.get("/api/proxy-image", async (req, res) => {
    const urlStr = req.query.url;
    if (!urlStr) {
      res.status(400).send("URL ausente");
      return;
    }
    const check = await validateSafeHttpsUrl(urlStr, ALLOWED_IMAGE_HOSTS);
    if (!check.valid || !check.url) {
      res.status(403).json({ success: false, error: check.error || "Acesso negado" });
      return;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1e4);
      const upstream = await fetch(check.url.toString(), { signal: controller.signal });
      clearTimeout(timeout);
      if (!upstream.ok) {
        res.status(upstream.status).end();
        return;
      }
      const contentType = upstream.headers.get("content-type") || "image/jpeg";
      if (!contentType.startsWith("image/")) {
        res.status(415).json({ success: false, error: "O recurso n\xE3o \xE9 uma imagem v\xE1lida." });
        return;
      }
      const contentLength = upstream.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) {
        res.status(413).json({ success: false, error: "Imagem excede o limite m\xE1ximo permitido." });
        return;
      }
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
      if (upstream.body) {
        const nodeStream = stream.Readable.fromWeb(upstream.body);
        nodeStream.pipe(res);
      } else {
        res.status(502).end();
      }
    } catch {
      res.status(502).end();
    }
  });
  async function proxyVideoRange(req, res, videoUrl) {
    const check = await validateSafeHttpsUrl(videoUrl);
    if (!check.valid || !check.url) {
      res.status(400).json({ success: false, error: check.error || "URL de v\xEDdeo inv\xE1lida." });
      return;
    }
    try {
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      };
      if (req.headers.range) {
        headers["Range"] = req.headers.range;
      }
      const upstreamReq = https.get(check.url.toString(), { headers }, (upstreamRes) => {
        res.status(upstreamRes.statusCode || 200);
        res.setHeader("Accept-Ranges", "bytes");
        if (upstreamRes.headers["content-range"]) {
          res.setHeader("Content-Range", upstreamRes.headers["content-range"]);
        }
        if (upstreamRes.headers["content-length"]) {
          res.setHeader("Content-Length", upstreamRes.headers["content-length"]);
        }
        res.setHeader("Content-Type", upstreamRes.headers["content-type"] || "video/mp4");
        upstreamRes.pipe(res);
      });
      req.on("close", () => {
        try {
          upstreamReq.destroy();
        } catch {
        }
      });
      upstreamReq.on("error", () => {
        if (!res.headersSent) res.status(502).end();
      });
    } catch {
      if (!res.headersSent) res.status(400).end();
    }
  }
  app.get("/api/stream-video", (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) {
      res.status(400).json({ success: false, error: "Par\xE2metro url \xE9 obrigat\xF3rio" });
      return;
    }
    proxyVideoRange(req, res, videoUrl);
  });
  app.get("/api/network-info", (_req, res) => {
    const lanIp = getLocalLanIp();
    res.json({
      success: true,
      lanIp,
      port: PORT,
      lanOrigin: `http://${lanIp}:${PORT}`
    });
  });
  app.get("/tv", (req, res) => {
    const rawSrc = typeof req.query.src === "string" ? req.query.src : "";
    const safeSrc = rawSrc.startsWith("/api/") ? rawSrc : "/api/stream";
    const rawTitle = typeof req.query.title === "string" ? req.query.title : "Popoca Streaming";
    const rawQuality = typeof req.query.quality === "string" ? req.query.quality : "1080p";
    const rawLang = typeof req.query.lang === "string" ? req.query.lang : "PT-BR";
    const startTime = parseSafeInt(req.query.time, 0, 0, 86400);
    const escapedTitle = escapeHtmlAttr(rawTitle);
    const escapedQuality = escapeHtmlAttr(rawQuality);
    const escapedLang = escapeHtmlAttr(rawLang);
    const escapedSrcJson = JSON.stringify(safeSrc);
    const escapedTitleJson = JSON.stringify(rawTitle);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>${escapedTitle} \xB7 Popoca TV</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #05070b;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .topbar {
      padding: 14px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      background: rgba(14, 18, 26, 0.92);
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .badge {
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(16, 185, 129, 0.18);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.35);
      white-space: nowrap;
    }
    .title {
      font-size: 15px;
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .btn {
      appearance: none;
      border: 1px solid rgba(255,255,255,0.16);
      background: rgba(255,255,255,0.08);
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      padding: 9px 14px;
      border-radius: 999px;
      text-decoration: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: transform 0.15s ease, background 0.15s ease;
    }
    .btn:hover { background: rgba(255,255,255,0.16); }
    .btn:active { transform: scale(0.97); }
    .btn-wvc {
      background: #10b981;
      color: #04130d;
      border-color: #34d399;
    }
    .btn-wvc:hover { background: #34d399; }
    .stage {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000;
      position: relative;
    }
    video {
      width: 100%;
      height: calc(100vh - 64px);
      max-height: calc(100vh - 64px);
      background: #000;
      outline: none;
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <span class="badge">POPOCA TV \xB7 ${escapedQuality} \xB7 ${escapedLang}</span>
      <span class="title">${escapedTitle}</span>
    </div>
    <div class="actions">
      <a id="wvcCallbackBtn" class="btn btn-wvc" href="#">Transmitir no Web Video Caster</a>
      <a id="wvcAndroidBtn" class="btn" href="#" style="display:none">App Android WVC</a>
      <a id="vlcBtn" class="btn" href="#">Abrir no VLC</a>
      <button id="fsBtn" class="btn" type="button">Tela Cheia</button>
    </div>
  </header>
  <main class="stage">
    <video id="tvPlayer" controls autoplay playsinline preload="auto"></video>
  </main>
  <script>
    (function () {
      var relSrc = ${escapedSrcJson};
      var mediaTitle = ${escapedTitleJson};
      var initialSec = ${startTime};
      var absStreamUrl = window.location.origin + relSrc;
      var player = document.getElementById('tvPlayer');
      player.src = absStreamUrl;

      player.addEventListener('loadedmetadata', function () {
        if (initialSec > 2 && isFinite(player.duration) && player.duration > initialSec + 5 && relSrc.indexOf('seek=') === -1) {
          try { player.currentTime = initialSec; } catch (e) {}
        }
      }, { once: true });

      var wvcUrl = 'wvc-x-callback://open?url=' + encodeURIComponent(absStreamUrl) + '&title=' + encodeURIComponent(mediaTitle);
      document.getElementById('wvcCallbackBtn').setAttribute('href', wvcUrl);

      if (/android/i.test(navigator.userAgent || '')) {
        var stripped = absStreamUrl.replace(/^https?:\\/\\//i, '');
        var scheme = absStreamUrl.indexOf('https://') === 0 ? 'https' : 'http';
        var intentUrl = 'intent://' + stripped + '#Intent;package=com.instantbits.cast.webvideo;scheme=' + scheme + ';S.title=' + encodeURIComponent(mediaTitle) + ';end';
        var androidBtn = document.getElementById('wvcAndroidBtn');
        androidBtn.style.display = 'inline-flex';
        androidBtn.setAttribute('href', intentUrl);
      }

      document.getElementById('vlcBtn').setAttribute('href', 'vlc://' + absStreamUrl);
      document.getElementById('fsBtn').addEventListener('click', function () {
        if (player.requestFullscreen) player.requestFullscreen();
        else if (player.webkitEnterFullscreen) player.webkitEnterFullscreen();
      });
    })();
  </script>
</body>
</html>`);
  });
  app.get("/api/health", (_req, res) => {
    const sqliteOk = db.ping();
    const mem = process.memoryUsage();
    const freeMem = os2.freemem();
    const totalMem = os2.totalmem();
    res.status(200).json({
      status: sqliteOk ? "healthy" : "degraded",
      sqlite: sqliteOk ? "connected" : "disconnected",
      uptime: Math.round(process.uptime()),
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      activeEngines: torrentEngine.getActiveEnginesCount?.() ?? 0,
      memory: mem.rss,
      memoryDetails: {
        rssMb: Math.round(mem.rss / 1048576),
        heapUsedMb: Math.round(mem.heapUsed / 1048576),
        freeSystemMb: Math.round(freeMem / 1048576),
        totalSystemMb: Math.round(totalMem / 1048576),
        renderLimitMb: 512
      }
    });
  });
  if (process.env.NODE_ENV === "production") {
    app.use(express.static(path3.resolve(__dirname, "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path3.resolve(__dirname, "dist", "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
      if (req.originalUrl.startsWith("/api") || req.originalUrl.startsWith("/@") || req.originalUrl.includes(".")) {
        return next();
      }
      try {
        const indexPath = path3.resolve(__dirname, "index.html");
        let template = fs3.readFileSync(indexPath, "utf-8");
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        next(e);
      }
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    const lanIp = getLocalLanIp();
    console.log(`[Popoca] Servidor Seguro (Vite + P2P) ativo em: http://localhost:${PORT}`);
    console.log(`[Popoca] Rede Wi-Fi Local (Smart TV / Web Video Caster): http://${lanIp}:${PORT}`);
  });
}
bootstrap().catch((err) => {
  console.error("[Popoca] Erro cr\xEDtico na inicializa\xE7\xE3o:", err);
  process.exit(1);
});
export {
  validateMagnet
};
