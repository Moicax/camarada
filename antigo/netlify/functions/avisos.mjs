// Roda de hora em hora na nuvem: para cada conta, faz a cópia de segurança do dia e,
// no horário que a pessoa escolheu em Ajustes, manda as notificações.
import { rodadaDeTodos } from '../../servidor/avisos.js';
import { migrarContaUnica } from '../../servidor/contas.js';
import { armazemNetlify } from '../../servidor/armazem-netlify.js';

export default async () => {
  const armazem = armazemNetlify();
  await migrarContaUnica(armazem);
  console.log(JSON.stringify(await rodadaDeTodos(armazem, { site: process.env.URL })));
};

export const config = { schedule: '@hourly' };
