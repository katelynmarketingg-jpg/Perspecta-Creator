// ---------------------------------------------------------------------------
// QUANDO O ENVIO É RECUSADO, A PESSOA PRECISA SABER POR QUÊ.
//
// O multer recusa arquivo grande demais, arquivo demais de uma vez e tipo não
// aceito lançando erros com código próprio. Sem tratar, eles caem no tratador
// genérico e viram "Erro interno do servidor" — que não diz nada e ainda dá a
// entender que o sistema quebrou, quando na verdade ele só disse não.
// ---------------------------------------------------------------------------
const MB = 1024 * 1024;

const emMB = (bytes) => (bytes >= MB ? `${Math.round(bytes / MB)} MB` : `${Math.round(bytes / 1024)} KB`);

/**
 * Middleware de erro para as rotas de envio. Recebe os limites da rota para
 * poder dizer o número exato — mensagem que diz "grande demais" sem dizer o
 * limite obriga a pessoa a adivinhar.
 */
export function erroDeEnvio({ porArquivo, porVez } = {}) {
  return (err, req, res, next) => {
    if (!err || err.name !== "MulterError") return next(err);
    const mensagens = {
      LIMIT_FILE_SIZE: porArquivo
        ? `Esse arquivo passa do limite de ${emMB(porArquivo)} por arquivo. Se for vídeo, exporte numa qualidade menor (1080p costuma resolver).`
        : "Esse arquivo é grande demais.",
      LIMIT_FILE_COUNT: porVez
        ? `Dá para mandar ${porVez} arquivos por vez. Mande em partes, que o que já subiu fica salvo.`
        : "Arquivos demais de uma vez.",
      LIMIT_UNEXPECTED_FILE: "Esse tipo de arquivo não é aceito aqui — mande foto, vídeo ou PDF.",
    };
    return res.status(400).json({ error: mensagens[err.code] || "Não consegui receber esse arquivo." });
  };
}
