// API do Camarada na nuvem: o mesmo rotas.js da prévia, guardando no Netlify Blobs.
import { tratar } from '../../servidor/rotas.js';
import { armazemNetlify } from '../../servidor/armazem-netlify.js';

export default async req => tratar(req, armazemNetlify(), { site: process.env.URL });

export const config = { path: '/api/*' };
