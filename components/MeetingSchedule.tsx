import React from 'react';
import { MeetingData, ParticipationType, Publisher, SpecialEvent, EventTemplate, Participation } from '../types';
import { EyeIcon, PencilIcon, TrashIcon, ShareIcon } from './icons';
import { TimedEvent, getFullScheduleWithTimings } from '../lib/scheduleUtils';
import { formatWeekIdToLabel, normalizeName } from '../lib/utils';
import { generateMeetingScheduleMessage, openWhatsApp } from '../lib/whatsappUtils';
import AssignmentShareButton from './AssignmentShareButton';

interface MeetingScheduleProps {
  scheduleData: MeetingData[];
  publishers: Publisher[];
  specialEvents: SpecialEvent[];
  eventTemplates: EventTemplate[];
  onEditWeek: (meetingData: MeetingData) => void;
  onDeleteWeek: (meetingData: MeetingData) => void;
  onOpenPrintableView: (meetingData: MeetingData) => void;
}

const TimedRow: React.FC<{event: TimedEvent, publishers: Publisher[], originalPart?: Participation}> = ({ event, publishers, originalPart }) => {
    const { startTime, partTitle, publisherName, durationText, isCounseling } = event;

    const findPublisher = (name: string) => {
        if (!name || name === 'N/A' || name === 'Não Designado') return undefined;
        return publishers.find(p => p.name === name || normalizeName(p.name) === normalizeName(name));
    };

    const publisher = findPublisher(publisherName);

    const participationData: Participation = originalPart || {
        id: event.id,
        publisherName: publisherName,
        partTitle: partTitle,
        type: event.sectionType as ParticipationType,
        week: '', 
        date: new Date().toISOString(),
        duration: parseInt(durationText.replace(/\D/g,'')) || 0
    };

    return (
        <div className={`grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-4 py-2 border-b border-gray-200 dark:border-gray-700 last:border-b-0 items-center ${isCounseling ? 'text-gray-500' : ''}`}>
            <span className="text-sm font-mono">{startTime}</span>
            <span className={`text-sm ${isCounseling ? 'italic pl-4' : 'text-gray-800 dark:text-gray-300'}`}>{partTitle}</span>
            <div className={`text-sm justify-self-end text-right ${isCounseling ? '' : 'text-gray-600 dark:text-gray-400'}`}>
                <span>{publisherName}</span>
            </div>
            <div className="w-8 flex justify-center">
                {!isCounseling && publisher && (
                    <AssignmentShareButton 
                        participation={participationData} 
                        publisher={publisher}
                    />
                )}
            </div>
            <span className="text-gray-400 dark:text-gray-500 w-16 inline-block text-right">{durationText}</span>
        </div>
    );
};


const MeetingSchedule: React.FC<MeetingScheduleProps> = ({ scheduleData, publishers, specialEvents, eventTemplates, onEditWeek, onDeleteWeek, onOpenPrintableView }) => {

    const handleShareSchedule = (meeting: MeetingData) => {
        const message = generateMeetingScheduleMessage(meeting, publishers, specialEvents, eventTemplates);
        openWhatsApp(undefined, message);
    };

    return (
        <div className="space-y-8">
            {scheduleData.map((meeting) => {
                const president = meeting.parts.find(p => p.type === ParticipationType.PRESIDENTE);
                const timedSchedule = getFullScheduleWithTimings(meeting, publishers, specialEvents, eventTemplates);
                
                const findOriginalPart = (eventId: string) => meeting.parts.find(p => p.id === eventId);

                // Helper to group parts for display without reordering them
                // We iterate through the timedSchedule and create blocks based on section changes
                const renderScheduleBlocks = () => {
                    const blocks: React.ReactNode[] = [];
                    let currentSection: string | null = null;
                    let currentBlockEvents: TimedEvent[] = [];

                    const flushBlock = () => {
                        if (currentBlockEvents.length > 0) {
                            // Determine header based on currentSection
                            let header = null;
                            if (currentSection === ParticipationType.TESOUROS) {
                                header = <h4 className="font-bold text-lg text-white bg-[#4A5568] dark:bg-blue-900/50 rounded-md px-3 py-1 mb-2">TESOUROS DA PALAVRA DE DEUS</h4>;
                            } else if (currentSection === ParticipationType.MINISTERIO) {
                                header = <h4 className="font-bold text-lg text-white bg-[#D69E2E] dark:bg-yellow-900/50 rounded-md px-3 py-1 mt-4 mb-2">FAÇA SEU MELHOR NO MINISTÉRIO</h4>;
                            } else if (currentSection === ParticipationType.VIDA_CRISTA || currentSection === ParticipationType.DIRIGENTE) {
                                // Only show header once for Life/Dirigente block if not already shown recently
                                // Ideally we group them. The logic below handles sequential grouping.
                                if (currentSection === ParticipationType.VIDA_CRISTA) { // Prefer VIDA_CRISTA as section key
                                     header = <h4 className="font-bold text-lg text-white bg-[#C53030] dark:bg-red-900/50 rounded-md px-3 py-1 mt-4 mb-2">NOSSA VIDA CRISTÃ</h4>;
                                }
                            }

                            blocks.push(
                                <div key={`block-${blocks.length}`}>
                                    {header}
                                    {currentBlockEvents.map(event => (
                                        <TimedRow key={event.id} event={event} publishers={publishers} originalPart={findOriginalPart(event.id)} />
                                    ))}
                                </div>
                            );
                        }
                        currentBlockEvents = [];
                    };

                    timedSchedule.forEach(event => {
                        // Normalize section types for grouping
                        let eventSection = event.sectionType;
                        if (eventSection === ParticipationType.DIRIGENTE) eventSection = ParticipationType.VIDA_CRISTA;
                        
                        if (eventSection !== currentSection) {
                            flushBlock();
                            currentSection = eventSection;
                        }
                        currentBlockEvents.push(event);
                    });
                    flushBlock(); // Flush last block

                    return blocks;
                };

                return (
                    <div key={meeting.week} className="bg-white dark:bg-gray-800 shadow-lg rounded-lg p-6">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{formatWeekIdToLabel(meeting.week)}</h3>
                                {president && <p className="text-md text-gray-600 dark:text-gray-400">Presidente: {president.publisherName}</p>}
                            </div>
                             <div className="flex items-center space-x-2">
                                <button onClick={() => handleShareSchedule(meeting)} className="p-2 text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200" title="Compartilhar Pauta no WhatsApp">
                                    <ShareIcon className="w-5 h-5" />
                                </button>
                                <button onClick={() => onOpenPrintableView(meeting)} className="p-2 text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-500" title="Visualizar/Imprimir">
                                    <EyeIcon className="w-5 h-5" />
                                </button>
                                <button onClick={() => onEditWeek(meeting)} className="p-2 text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-500" title="Editar Pauta">
                                    <PencilIcon className="w-5 h-5" />
                                </button>
                                <button onClick={() => onDeleteWeek(meeting)} className="p-2 text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-500" title="Excluir Pauta">
                                    <TrashIcon className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                        
                        <div className="space-y-2">
                           {renderScheduleBlocks()}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default MeetingSchedule;