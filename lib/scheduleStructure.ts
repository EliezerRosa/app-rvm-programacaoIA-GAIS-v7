import { ParticipationType } from '../types';
import { normalizeName } from './utils';

export interface StandardPart {
    id?: string;
    partTitle: string;
    type: ParticipationType;
    duration?: number;
    requiresHelper: boolean;
    preAssignedTo?: string; // 'Presidente' ou nome específico
}

/**
 * Esta função é a FONTE DA VERDADE para a estrutura da reunião.
 * Ela recebe uma lista bruta de partes (ex: da extração da IA ou do banco de dados)
 * e retorna uma lista ordenada, limpa e com as partes fixas (Presidente, Orações) garantidas.
 */
export function getStandardizedScheduleStructure(rawParts: StandardPart[]): StandardPart[] {
    const orderedParts: StandardPart[] = [];

    // Helpers para encontrar partes na lista bruta
    const findPart = (type: ParticipationType, titleIncludes?: string) => {
        return rawParts.find(p => 
            p.type === type && 
            (!titleIncludes || p.partTitle.toLowerCase().includes(titleIncludes.toLowerCase()))
        );
    };

    // --- 1. ABERTURA ---
    // Garante Presidente
    const president = findPart(ParticipationType.PRESIDENTE, 'Presidente') || {
        partTitle: 'Presidente',
        type: ParticipationType.PRESIDENTE,
        duration: 0,
        requiresHelper: false
    };
    orderedParts.push(president);

    // Garante Oração Inicial
    const openingPrayer = findPart(ParticipationType.ORACAO_INICIAL) || {
        partTitle: 'Oração Inicial',
        type: ParticipationType.ORACAO_INICIAL,
        duration: 1,
        requiresHelper: false,
        preAssignedTo: 'Presidente'
    };
    orderedParts.push(openingPrayer);

    // Garante Comentários Iniciais
    const openingComments = findPart(ParticipationType.PRESIDENTE, 'Comentários Iniciais') || {
        partTitle: 'Comentários Iniciais',
        type: ParticipationType.PRESIDENTE,
        duration: 1,
        requiresHelper: false,
        preAssignedTo: 'Presidente'
    };
    orderedParts.push(openingComments);

    // --- 2. TESOUROS DA PALAVRA DE DEUS ---
    // Ordem estrita: Discurso -> Joias -> Leitura
    
    // A. Discurso (10 min)
    const treasuresDiscourse = rawParts.find(p => 
        p.type === ParticipationType.TESOUROS && 
        !p.partTitle.toLowerCase().includes('joias') && 
        !p.partTitle.toLowerCase().includes('leitura')
    );
    if (treasuresDiscourse) orderedParts.push(treasuresDiscourse);

    // B. Joias Espirituais
    const gems = findPart(ParticipationType.TESOUROS, 'Joias');
    if (gems) orderedParts.push(gems);

    // C. Leitura da Bíblia (SEMPRE POR ÚLTIMO EM TESOUROS)
    const bibleReading = findPart(ParticipationType.TESOUROS, 'Leitura');
    if (bibleReading) orderedParts.push(bibleReading);
    
    // Fallback: Adiciona quaisquer outras partes de Tesouros que não foram capturadas acima
    const otherTreasures = rawParts.filter(p => 
        p.type === ParticipationType.TESOUROS && 
        p !== treasuresDiscourse && 
        p !== gems && 
        p !== bibleReading
    );
    orderedParts.push(...otherTreasures);


    // --- 3. FAÇA SEU MELHOR NO MINISTÉRIO ---
    const ministryParts = rawParts.filter(p => p.type === ParticipationType.MINISTERIO || p.type === ParticipationType.AJUDANTE);
    // Mantém a ordem original da extração para o ministério
    orderedParts.push(...ministryParts);


    // --- 4. NOSSA VIDA CRISTÃ ---
    const lifeParts = rawParts.filter(p => p.type === ParticipationType.VIDA_CRISTA);
    orderedParts.push(...lifeParts);

    // Estudo Bíblico de Congregação (Sempre no final da seção Vida Cristã)
    const cbsConductor = findPart(ParticipationType.DIRIGENTE);
    if (cbsConductor) {
        orderedParts.push(cbsConductor);
        
        // Leitor do EBC (Imediatamente após o Dirigente)
        const cbsReader = findPart(ParticipationType.LEITOR) || {
            partTitle: 'Leitor do EBC',
            type: ParticipationType.LEITOR,
            duration: 0,
            requiresHelper: false
        };
        orderedParts.push(cbsReader);
    }


    // --- 5. ENCERRAMENTO ---
    
    // SANITIZAÇÃO FINAL (CORREÇÃO DE TÍTULOS E TIPOS ERRADOS NA SEÇÃO FINAL)
    // Se alguma parte no final da lista bruta foi marcada como "Comentários Iniciais" por engano,
    // ou se só temos um "Comentários" sobrando e estamos no fim, assumimos que é Final.
    
    // Primeiro, tentamos encontrar explicitamente
    let closingComments = findPart(ParticipationType.COMENTARIOS_FINAIS);

    // Se não achou, procura por "Comentários Iniciais" que esteja solto (já usamos o verdadeiro lá em cima)
    if (!closingComments) {
        const orphanedComments = rawParts.filter(p => 
            (p.type === ParticipationType.PRESIDENTE && p.partTitle.toLowerCase().includes('comentários')) &&
            p !== openingComments // Garante que não é o primeiro
        );
        // Se tiver um órfão, pega o último (provavelmente o do encerramento)
        if (orphanedComments.length > 0) {
            const candidate = orphanedComments[orphanedComments.length - 1];
            // Transforma em Comentários Finais
            closingComments = {
                ...candidate,
                partTitle: 'Comentários Finais',
                type: ParticipationType.COMENTARIOS_FINAIS
            };
        }
    }

    // Se ainda não achou, cria o padrão
    if (!closingComments) {
        closingComments = {
            partTitle: 'Comentários Finais',
            type: ParticipationType.COMENTARIOS_FINAIS,
            duration: 3,
            requiresHelper: false,
            preAssignedTo: 'Presidente'
        };
    } else {
        // Garante o título correto
        closingComments.partTitle = 'Comentários Finais';
        closingComments.type = ParticipationType.COMENTARIOS_FINAIS;
        closingComments.preAssignedTo = 'Presidente';
    }
    
    orderedParts.push(closingComments);

    // Oração Final
    const closingPrayer = findPart(ParticipationType.ORACAO_FINAL) || {
        partTitle: 'Oração Final',
        type: ParticipationType.ORACAO_FINAL,
        duration: 1,
        requiresHelper: false
    };
    orderedParts.push(closingPrayer);

    return orderedParts;
}