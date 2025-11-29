
import { Participation, Publisher, MeetingData, ParticipationType, SpecialEvent, EventTemplate } from '../types';
import { calculatePartDate, formatWeekIdToLabel } from './utils';
import { getFullScheduleWithTimings } from './scheduleUtils';

export const openWhatsApp = (phone: string | undefined, text: string) => {
    const encodedText = encodeURIComponent(text);
    const url = phone 
        ? `https://wa.me/55${phone.replace(/\D/g, '')}?text=${encodedText}`
        : `https://api.whatsapp.com/send?text=${encodedText}`;
    window.open(url, '_blank');
};

export const generateIndividualAssignmentMessage = (
    participation: Participation,
    publisher: Publisher,
    helper?: Publisher
): string => {
    const date = new Date(participation.date);
    const dateStr = date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    
    let msg = `*DESIGNAÇÃO PARA A REUNIÃO*\n`;
    msg += `*NOSSA VIDA E MINISTÉRIO CRISTÃO*\n\n`;
    msg += `Olá, *${publisher.name}*! Segue sua designação:\n\n`;
    msg += `📅 *Data:* ${dateStr}\n`;
    msg += `📖 *Parte:* ${participation.partTitle}\n`;
    
    if (participation.duration) {
        msg += `⏱️ *Tempo:* ${participation.duration} min\n`;
    }
    
    if (helper) {
        msg += `🤝 *Ajudante:* ${helper.name}\n`;
    }
    
    msg += `📍 *Local:* Salão Principal\n\n`;
    msg += `_Por favor, prepare-se bem. Se não puder cuidar desta parte, avise com antecedência._`;
    
    return msg;
};

export const generateMeetingScheduleMessage = (
    meeting: MeetingData, 
    publishers: Publisher[], 
    specialEvents: SpecialEvent[], 
    eventTemplates: EventTemplate[]
): string => {
    const timedSchedule = getFullScheduleWithTimings(meeting, publishers, specialEvents, eventTemplates);
    const weekLabel = formatWeekIdToLabel(meeting.week);
    
    let msg = `*PROGRAMAÇÃO DA REUNIÃO*\n`;
    msg += `🗓️ *Semana:* ${weekLabel}\n`;
    msg += `🏛️ *Congregação Parque Jacaraípe*\n\n`;

    let currentSection = '';
    
    timedSchedule.forEach(event => {
        if (event.sectionType === 'TRANSITION') return;
        
        let sectionName = '';
        if (event.sectionType === 'OPENING') sectionName = 'I. ABERTURA';
        else if (event.sectionType === ParticipationType.TESOUROS) sectionName = 'II. TESOUROS DA PALAVRA';
        else if (event.sectionType === ParticipationType.MINISTERIO) sectionName = 'III. FAÇA SEU MELHOR';
        else if (event.sectionType === ParticipationType.VIDA_CRISTA || event.sectionType === ParticipationType.DIRIGENTE) sectionName = 'IV. NOSSA VIDA CRISTÃ';
        else if (event.sectionType === 'CLOSING') sectionName = 'V. ENCERRAMENTO';
        
        if (sectionName && sectionName !== currentSection && !event.isCounseling) {
            msg += `\n*${sectionName}*\n`;
            currentSection = sectionName;
        }

        const icon = event.partTitle.toLowerCase().includes('cântico') ? '🎶' : 
                     event.partTitle.toLowerCase().includes('oração') ? '🙏' : 
                     event.isCounseling ? '🛡️' : '▪️';
        
        const time = event.startTime;
        const title = event.partTitle;
        const name = event.publisherName;
        
        if (!event.isCounseling) {
            msg += `${time} ${icon} *${title}*`;
            if (name && name !== 'N/A') msg += `\n      👤 _${name}_`;
            msg += `\n`;
        }
    });
    
    msg += `\n_Contamos com a presença de todos!_`;
    return msg;
};