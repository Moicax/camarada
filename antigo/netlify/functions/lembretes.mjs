// Roda a cada minuto na nuvem: tarefas com hora avisam faltando 3 h, 1 h e 10 min.
// Fica leve de propósito (só lê os dados de cada conta) para caber de sobra no plano grátis.
import { lembretesDeTodos } from '../../servidor/avisos.js';
import { armazemNetlify } from '../../servidor/armazem-netlify.js';

export default async () => {
  const r = await lembretesDeTodos(armazemNetlify(), { site: process.env.URL });
  if (Object.values(r).some(x => x?.lembretes || typeof x === 'string')) console.log(JSON.stringify(r));
};

export const config = { schedule: '* * * * *' };
