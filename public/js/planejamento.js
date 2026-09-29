// public/js/planejamento.js
// Cálculo da Meta de Caixa: dado o saldo atual e as contas pendentes (em ordem
// de vencimento), quanto falta pra cobrir cada uma e quanto vender por dia
// até o vencimento. Função pura — usada no dashboard e nos testes (Jest).

// Diferença em dias entre duas datas 'YYYY-MM-DD' (b - a)
function diasEntre(a, b) {
    const utc = (s) => { const [ano, mes, dia] = s.split('-').map(Number); return Date.UTC(ano, mes - 1, dia); };
    return Math.round((utc(b) - utc(a)) / 86400000);
}

function calcularPlanejamento({ saldo, contas, mediaDiaria, hoje }) {
    let acumulado = 0;
    const itens = contas.map(c => {
        acumulado += Number(c.valor) || 0;
        const falta = Math.max(0, acumulado - saldo);
        const dias = diasEntre(hoje, c.vencimento);
        const vencida = dias < 0;
        // Vence hoje ou já venceu: o prazo pra vender é "hoje" (1 dia)
        const diasParaVender = Math.max(dias, 1);
        const porDia = falta > 0 ? falta / diasParaVender : 0;
        const diasNoRitmo = falta > 0 && mediaDiaria > 0 ? Math.ceil(falta / mediaDiaria) : null;

        let status;
        if (falta === 0)                        status = 'coberta';
        else if (vencida)                       status = 'vencida';
        else if (mediaDiaria >= porDia)         status = 'no-ritmo';
        else                                    status = 'abaixo';

        return {
            id: c.id, descricao: c.descricao, valor: Number(c.valor) || 0, vencimento: c.vencimento,
            acumulado, falta, dias, diasParaVender, porDia, diasNoRitmo, vencida, status
        };
    });

    return {
        totalPendente: acumulado,
        faltaTotal: Math.max(0, acumulado - saldo),
        sobra: Math.max(0, saldo - acumulado),
        proxima: itens.find(i => i.falta > 0) || null,
        itens
    };
}

if (typeof module !== 'undefined') module.exports = { calcularPlanejamento, diasEntre };
