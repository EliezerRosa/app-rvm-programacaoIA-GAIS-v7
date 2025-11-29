import React, { useState, useEffect, useMemo } from 'react';
import { Publisher, Participation, ParticipationType, Rule, SpecialEvent, EventTemplate, Workbook, MeetingData } from '../types';
import { calculatePartDate, generateUUID, normalizeName, validatePairing, parseWeekDate, openHtmlInNewTab } from '../lib/utils';
import { extractScheduleFromPdf, identifyWeeksInPdf } from '../lib/aiScheduler';
import { ArrowUpTrayIcon, SparklesIcon, ClipboardDocumentCheckIcon, ExclamationCircleIcon, PencilIcon, DocumentTextIcon, TrashIcon, EyeIcon } from './icons';
import { PartToAssign, AssignmentState, getSortedCandidates, performAutoFill } from '../lib/autoFill';
import { getStandardizedScheduleStructure, StandardPart } from '../lib/scheduleStructure';
import { getScheduleHtml } from '../lib/scheduleTemplate';

export interface ManualAssignmentState {
    file: File | null;
    fileBase64: string | null;
    availableWeeks: string[];
    weekLabel: string;
    parts: PartToAssign[];
    assignments: Record<string, AssignmentState>;
}

interface ManualAssignmentProps {
    publishers: Publisher[];
    participations: Participation[];
    rules: Rule[];
    specialEvents: SpecialEvent[];
    eventTemplates: EventTemplate[];
    workbooks: Workbook[]; 
    onSave: (newParticipations: Participation[]) => Promise<void>;
    onEditPublisher?: (publisher: Publisher) => void;
    initialState: ManualAssignmentState;
    onStateChange: (newState: ManualAssignmentState) => void;
}

const ManualAssignment: React.FC<ManualAssignmentProps> = ({ publishers, participations, rules, specialEvents, eventTemplates, workbooks, onSave, onEditPublisher, initialState, onStateChange }) => {
    const [isAnalyzing, setIsAnalyzing] = useState(false); 
    const [isGenerating, setIsGenerating] = useState(false); 
    const [error, setError] = useState('');
    const [viewingRulesPart, setViewingRulesPart] = useState<PartToAssign | null>(null);
    const [sortBy, setSortBy] = useState<'lastDate' | 'name'>('lastDate');
    const [showBlocked, setShowBlocked] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [sourceTab, setSourceTab] = useState<'upload' | 'library'>('upload');

    const updateState = (updates: Partial<ManualAssignmentState>) => {
        onStateChange({ ...initialState, ...updates });
    };

    const { fileBase64, availableWeeks, weekLabel, parts, assignments } = initialState;

    const processFile = (selectedFile: File) => {
        setError('');
        const reader = new FileReader();
        reader.readAsDataURL(selectedFile);
        reader.onload = () => {
            updateState({
                file: selectedFile,
                fileBase64: reader.result as string,
                availableWeeks: [],
                weekLabel: '',
                parts: [],
                assignments: {}
            });
        };
    };

    const handleSelectWorkbook = (workbookId: string) => {
        const workbook = workbooks.find(wb => wb.id === workbookId);
        if (workbook) {
            const dataUrl = `data:application/pdf;base64,${workbook.fileData}`;
            updateState({
                file: null, 
                fileBase64: dataUrl,
                availableWeeks: [],
                weekLabel: '',
                parts: [],
                assignments: {}
            });
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) processFile(selectedFile);
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragging(true); };
    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragging(false); };
    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const droppedFile = e.dataTransfer.files[0];
            if (droppedFile.type === 'application/pdf') processFile(droppedFile);
            else setError('Por favor, solte apenas arquivos PDF.');
        }
    };

    const analyzePdf = async () => {
        if (!fileBase64) { setError('Por favor, selecione uma apostila.'); return; }
        setIsAnalyzing(true);
        setError('');
        updateState({ availableWeeks: [] });
        try {
            const weeks = await identifyWeeksInPdf(fileBase64);
            if (weeks.length === 0) {
                setError('Nenhuma semana identificada.');
            } else {
                updateState({ availableWeeks: weeks });
            }
        } catch (err: any) {
            setError(`Erro ao analisar PDF: ${err.message}`);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleSelectWeek = async (selectedWeek: string) => {
        if (!fileBase64) return;
        setIsGenerating(true);
        setError('');
        updateState({ weekLabel: '', parts: [], assignments: {} });

        try {
            const structuredData = await extractScheduleFromPdf(fileBase64, selectedWeek);
            
            const rawStandardParts: StandardPart[] = [];
            let currentSectionContext: ParticipationType = ParticipationType.VIDA_CRISTA;

            structuredData.parts.forEach((item, index) => {
                const titleLower = item.part.toLowerCase();

                if (item.type === 'SECTION_HEADER') {
                    if (titleLower.includes('tesouros')) currentSectionContext = ParticipationType.TESOUROS;
                    else if (titleLower.includes('ministério')) currentSectionContext = ParticipationType.MINISTERIO;
                    else if (titleLower.includes('vida cristã')) currentSectionContext = ParticipationType.VIDA_CRISTA;
                    return; 
                }

                if (item.type === 'CÂNTICO' || titleLower.includes('término') || titleLower.includes('cântico')) return;

                let type = currentSectionContext;
                
                if (item.type === 'BIBLE_STUDY' || titleLower.includes('estudo bíblico')) type = ParticipationType.DIRIGENTE;
                else if (item.type === 'CLOSING') {
                    if (titleLower.includes('oração')) type = ParticipationType.ORACAO_FINAL;
                    else if (titleLower.includes('comentários')) type = ParticipationType.COMENTARIOS_FINAIS;
                } else if (item.type === 'STUDENT_PART') {
                    if (currentSectionContext === ParticipationType.TESOUROS) type = ParticipationType.TESOUROS;
                    else type = ParticipationType.MINISTERIO;
                }

                if (titleLower.includes('oração') && !titleLower.includes('final') && index < 4) {
                    type = ParticipationType.ORACAO_INICIAL;
                }

                let requiresHelper = false;
                if (type === ParticipationType.MINISTERIO && !titleLower.includes('discurso')) {
                    requiresHelper = true;
                }

                let preAssignedTo: string | undefined = undefined;
                if (type === ParticipationType.ORACAO_INICIAL) preAssignedTo = 'Presidente';
                if (type === ParticipationType.COMENTARIOS_FINAIS) preAssignedTo = 'Presidente';

                rawStandardParts.push({
                    partTitle: item.part,
                    type,
                    duration: item.min,
                    requiresHelper,
                    preAssignedTo
                });

                const isBibleReading = titleLower.includes('leitura da bíblia');
                const isMinistryStudentPart = type === ParticipationType.MINISTERIO && !titleLower.includes('discurso');
                
                if (isBibleReading || isMinistryStudentPart) {
                    rawStandardParts.push({
                        partTitle: 'Aconselhamento',
                        type: ParticipationType.PRESIDENTE,
                        duration: 1,
                        requiresHelper: false,
                        preAssignedTo: 'Presidente'
                    });
                }
            });

            const standardizedParts = getStandardizedScheduleStructure(rawStandardParts);

            const finalParts: PartToAssign[] = standardizedParts.map((p, index) => ({
                id: p.id || `std-man-part-${index}`,
                partTitle: p.partTitle,
                type: p.type,
                duration: p.duration,
                requiresHelper: p.requiresHelper,
                preAssignedTo: p.preAssignedTo
            }));

            const initialAssignments: Record<string, AssignmentState> = {};
            finalParts.forEach(p => {
                initialAssignments[p.id] = { studentId: '', helperId: p.requiresHelper ? '' : undefined };
            });
            
            updateState({ weekLabel: structuredData.header, parts: finalParts, assignments: initialAssignments });

        } catch (aiError: any) {
            console.error(aiError);
            setError(`Erro na geração da pauta: ${aiError.message}`);
        } finally {
            setIsGenerating(false);
        }
    };

    useEffect(() => {
        if (parts.length === 0) return;
        const presidentPart = parts.find(p => p.type === ParticipationType.PRESIDENTE && p.partTitle === 'Presidente');
        const presidentId = presidentPart ? assignments[presidentPart.id]?.studentId : '';

        if (presidentId) {
            let changed = false;
            const nextAssignments = { ...assignments };
            parts.forEach(p => {
                if (p.preAssignedTo === 'Presidente' && nextAssignments[p.id]?.studentId !== presidentId) {
                    nextAssignments[p.id] = { ...nextAssignments[p.id], studentId: presidentId };
                    changed = true;
                }
            });
            if (changed) updateState({ assignments: nextAssignments });
        }
    }, [assignments, parts]);

    const getCandidates = (part: PartToAssign, isHelper: boolean) => 
        getSortedCandidates(part, isHelper, publishers, participations, rules, weekLabel, showBlocked, sortBy);

    const handleAutoFill = () => {
        const filledAssignments = performAutoFill(parts, assignments, publishers, participations, rules, weekLabel);
        updateState({ assignments: filledAssignments });
    };

    const handleRemovePart = (partId: string) => {
        if (!window.confirm("Tem certeza que deseja remover esta parte da pauta?")) return;
        
        const newParts = parts.filter(p => p.id !== partId);
        const newAssignments = { ...assignments };
        delete newAssignments[partId];
        
        updateState({ parts: newParts, assignments: newAssignments });
    };

    const handleAssignmentChange = (partId: string, field: keyof AssignmentState, value: string) => {
        const nextAssignments = { ...assignments };
        Object.keys(nextAssignments).forEach(otherPartId => {
            if (otherPartId !== partId) {
                const otherAssignment = nextAssignments[otherPartId];
                if (otherAssignment.studentId === value) {
                    const otherPart = parts.find(p => p.id === otherPartId);
                    if (otherPart && otherPart.preAssignedTo !== 'Presidente') {
                        nextAssignments[otherPartId] = { ...otherAssignment, studentId: '' };
                    }
                }
                if (otherAssignment.helperId === value) {
                    nextAssignments[otherPartId] = { ...otherAssignment, helperId: '' };
                }
            }
        });
        nextAssignments[partId] = { ...nextAssignments[partId], [field]: value };
        updateState({ assignments: nextAssignments });
    };

    // --- PRINT PREVIEW HANDLER ---
    const handlePrintPreview = () => {
        const dateObj = parseWeekDate(weekLabel);
        const weekId = dateObj.getTime() !== 0 ? dateObj.toISOString().split('T')[0] : weekLabel;
        const dateStr = calculatePartDate(weekId);

        const tempParticipations: Participation[] = [];

        parts.forEach(part => {
            const assign = assignments[part.id];
            const sName = assign?.studentId ? (publishers.find(p => p.id === assign.studentId)?.name || assign.studentId) : 'N/D';
            
            tempParticipations.push({
                id: generateUUID(),
                week: weekId,
                date: dateStr,
                type: part.type,
                partTitle: part.partTitle,
                publisherName: sName,
                duration: part.duration
            });

            if (part.requiresHelper) {
                const hName = assign?.helperId ? (publishers.find(p => p.id === assign.helperId)?.name || '') : 'N/D';
                tempParticipations.push({
                    id: generateUUID(),
                    week: weekId,
                    date: dateStr,
                    type: ParticipationType.AJUDANTE,
                    partTitle: 'Ajudante',
                    publisherName: hName
                });
            }
        });

        const meetingData: MeetingData = {
            week: weekId,
            parts: tempParticipations
        };

        const html = getScheduleHtml(meetingData, "Parque Jacaraípe", publishers, specialEvents, eventTemplates);
        openHtmlInNewTab(html);
    };

    const handleSave = async () => {
        for (const part of parts) {
            const assign = assignments[part.id];
            if (!assign.studentId && part.preAssignedTo !== 'Presidente') { alert(`Selecione um designado para "${part.partTitle}".`); return; }
            if (part.requiresHelper && !assign.helperId) { alert(`Selecione um ajudante para "${part.partTitle}".`); return; }
        }
        const finalParticipations: Participation[] = [];
        const dateObj = parseWeekDate(weekLabel);
        const weekId = dateObj.getTime() !== 0 ? dateObj.toISOString().split('T')[0] : weekLabel;
        const dateStr = calculatePartDate(weekId);

        parts.forEach(part => {
            const assign = assignments[part.id];
            if (!assign.studentId) return;
            const sName = publishers.find(p => p.id === assign.studentId)?.name || assign.studentId;
            finalParticipations.push({ id: generateUUID(), week: weekId, date: dateStr, type: part.type, partTitle: part.partTitle, publisherName: sName, duration: part.duration });
            if (part.requiresHelper && assign.helperId) {
                const hName = publishers.find(p => p.id === assign.helperId)?.name || '';
                finalParticipations.push({ id: generateUUID(), week: weekId, date: dateStr, type: ParticipationType.AJUDANTE, partTitle: 'Ajudante', publisherName: hName });
            }
        });
        await onSave(finalParticipations);
        updateState({ parts: [], weekLabel: '', assignments: {} });
    };
    
    const getRelevantRules = (part: PartToAssign) => {
        return rules.filter(rule => rule.isActive).filter(rule => {
            const hasPartTypeCondition = rule.conditions.some(c => c.fact === 'partType');
            if (!hasPartTypeCondition) return true;
            return rule.conditions.some(c => 
                c.fact === 'partType' && (
                    (c.operator === 'equal' && c.value === part.type) ||
                    (c.operator === 'in' && Array.isArray(c.value) && (c.value as string[]).includes(part.type))
                )
            );
        });
    };

    const formatDate = (ts: number) => (ts === 0 ? 'Nunca' : new Date(ts).toLocaleDateString('pt-BR'));

    return (
        <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6 relative">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6 flex items-center">Designação Manual Inteligente (PDF)</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 absolute top-7 right-6">
                Nota: A IA pode cometer erros na extração. Verifique a pauta gerada.
            </p>

            {!weekLabel && (
                <div className="mb-8">
                    <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4">
                        <button
                            className={`py-2 px-4 text-sm font-medium border-b-2 ${sourceTab === 'upload' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                            onClick={() => setSourceTab('upload')}
                        >
                            Novo Upload
                        </button>
                        <button
                            className={`py-2 px-4 text-sm font-medium border-b-2 ${sourceTab === 'library' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                            onClick={() => setSourceTab('library')}
                        >
                            Apostilas Salvas ({workbooks.filter(w => !w.isDeleted).length})
                        </button>
                    </div>

                    {sourceTab === 'upload' && (
                        <div className={`p-6 border-2 border-dashed rounded-lg text-center transition-colors ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300'}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
                            <ArrowUpTrayIcon className="mx-auto h-12 w-12 text-gray-400" />
                            <div className="mt-4 flex text-sm justify-center"><label htmlFor="manual-file-upload" className="relative cursor-pointer font-semibold text-indigo-600 hover:text-indigo-500"><span>Carregar Apostila</span><input id="manual-file-upload" type="file" className="sr-only" accept="application/pdf" onChange={handleFileChange} /></label><p className="pl-1">ou arraste e solte</p></div>
                        </div>
                    )}

                    {sourceTab === 'library' && (
                         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {workbooks.filter(w => !w.isDeleted).map(wb => (
                                <button key={wb.id} onClick={() => handleSelectWorkbook(wb.id)} className="flex items-center p-4 bg-gray-50 border rounded-lg hover:bg-indigo-50 text-left"><DocumentTextIcon className="h-8 w-8 text-indigo-500 mr-3" /><div><p className="text-sm font-medium">{wb.name}</p></div></button>
                            ))}
                        </div>
                    )}

                    {(fileBase64 && availableWeeks.length === 0) && (
                         <div className="mt-6 text-center">
                            <button onClick={analyzePdf} disabled={isAnalyzing} className="inline-flex items-center px-6 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400">{isAnalyzing ? 'Analisando...' : 'Analisar Semanas'}</button>
                        </div>
                    )}
                    {error && <p className="mt-4 text-sm text-red-600 text-center">{error}</p>}
                </div>
            )}

            {availableWeeks.length > 0 && !weekLabel && (
                <div className="mb-8 text-center">
                    <h3 className="text-lg font-medium mb-4">Selecione uma Semana</h3>
                    {isGenerating ? <div className="flex justify-center"><div className="animate-spin h-8 w-8 border-b-2 border-indigo-600"></div></div> : 
                        <div className="grid grid-cols-3 gap-3">{availableWeeks.map(week => <button key={week} onClick={() => handleSelectWeek(week)} className="px-4 py-3 bg-white border rounded-lg hover:bg-indigo-50">{week}</button>)}</div>
                    }
                    <button onClick={() => updateState({ availableWeeks: [], file: null, fileBase64: null })} className="mt-6 text-sm text-gray-500 hover:underline">Voltar</button>
                </div>
            )}

            {weekLabel && parts.length > 0 && (
                <div className="space-y-6 border-t pt-6">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-lg font-medium text-indigo-600">{weekLabel}</h3>
                        <div className="flex gap-3">
                            <div className="flex items-center"><input type="checkbox" checked={showBlocked} onChange={e => setShowBlocked(e.target.checked)} className="h-4 w-4"/><label className="ml-2 text-sm">Mostrar Bloqueados</label></div>
                            <button onClick={handleAutoFill} className="px-3 py-2 border rounded-md text-indigo-700 bg-indigo-100"><SparklesIcon className="h-4 w-4 mr-2"/> Auto-Fill</button>
                            <button onClick={() => updateState({ weekLabel: '', parts: [] })} className="text-sm text-gray-500 px-3 py-2">Trocar Semana</button>
                        </div>
                    </div>
                    
                    {parts.map((part) => {
                        const candidates = getCandidates(part, false);
                        const helperCandidates = part.requiresHelper ? getCandidates(part, true) : [];
                        const currentAssign = assignments[part.id];
                        const borderColor = part.type === ParticipationType.TESOUROS ? 'border-blue-500' : part.type === ParticipationType.MINISTERIO ? 'border-yellow-500' : 'border-red-500';

                        return (
                            <div key={part.id} className={`pl-4 py-2 border-l-4 ${borderColor} bg-gray-50 mb-2 rounded-r`}>
                                <div className="mb-1 flex justify-between items-center">
                                    <span className="font-bold text-sm text-gray-900">{part.partTitle}</span>
                                    <div className="flex items-center space-x-2">
                                        <span className="text-xs text-gray-500">({part.duration} min)</span>
                                        <button onClick={() => setViewingRulesPart(part)} className="text-gray-400 hover:text-indigo-600"><ExclamationCircleIcon className="w-5 h-5" /></button>
                                        <button onClick={() => handleRemovePart(part.id)} className="text-gray-400 hover:text-red-600" title="Remover Parte"><TrashIcon className="w-5 h-5" /></button>
                                    </div>
                                </div>
                                <div className="flex gap-4">
                                    <div className="flex-1 flex items-center gap-2">
                                        <select 
                                            className="w-full border border-gray-300 rounded-md text-sm font-bold bg-white text-gray-900 shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                                            value={currentAssign?.studentId || ''} 
                                            onChange={e => handleAssignmentChange(part.id, 'studentId', e.target.value)} 
                                            disabled={!!part.preAssignedTo && part.partTitle !== 'Presidente'}
                                        >
                                            <option value="" disabled className="text-gray-500 font-normal">Selecione...</option>
                                            {candidates.map(c => {
                                                const isSelectedElsewhere = (Object.values(assignments) as AssignmentState[]).some(a => a.studentId === c.publisher.id || a.helperId === c.publisher.id) && currentAssign?.studentId !== c.publisher.id;
                                                const style = !c.isValid ? 'text-red-500 italic' : isSelectedElsewhere ? 'text-gray-400' : 'text-gray-900';
                                                return (
                                                    <option key={c.publisher.id} value={c.publisher.id} className={`bg-white text-gray-900 font-bold ${style}`}>
                                                        {c.publisher.name} - {formatDate(c.lastDate)}
                                                        {!c.isValid ? ' [Bloqueado]' : isSelectedElsewhere ? ' (Já designado)' : ''}
                                                    </option>
                                                );
                                            })}
                                        </select>
                                        {currentAssign?.studentId && onEditPublisher && <button onClick={() => onEditPublisher(publishers.find(p => p.id === currentAssign.studentId)!)}><PencilIcon className="w-4 h-4"/></button>}
                                    </div>
                                    {part.requiresHelper && (
                                        <div className="flex-1 flex items-center gap-2">
                                            <select 
                                                className="w-full border border-gray-300 rounded-md text-sm font-bold bg-white text-gray-900 shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                                                value={currentAssign?.helperId || ''} 
                                                onChange={e => handleAssignmentChange(part.id, 'helperId', e.target.value)}
                                            >
                                                <option value="" disabled className="text-gray-500 font-normal">Ajudante...</option>
                                                {helperCandidates.map(c => (
                                                    <option key={c.publisher.id} value={c.publisher.id} className="bg-white text-gray-900 font-bold">
                                                        {c.publisher.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    <div className="flex justify-end pt-4 space-x-4">
                         <button onClick={handlePrintPreview} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md shadow hover:bg-gray-200 flex items-center">
                             <EyeIcon className="w-5 h-5 mr-2" />
                             Imprimir (Preview)
                         </button>
                        <button onClick={handleSave} className="px-6 py-2 bg-indigo-600 text-white rounded-md shadow">Salvar Pauta</button>
                    </div>
                </div>
            )}

            {/* MODAL DE REGRAS */}
            {viewingRulesPart && (
                <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center" onClick={() => setViewingRulesPart(null)}>
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md m-4 p-6" onClick={e => e.stopPropagation()}>
                        <div className="mb-4">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Critérios de Seleção</h3>
                            <p className="text-sm text-gray-500">Regras aplicadas para: <span className="font-medium text-indigo-600">{viewingRulesPart.partTitle}</span></p>
                        </div>
                        
                        <div className="max-h-64 overflow-y-auto mb-4">
                            <ul className="space-y-2">
                                {getRelevantRules(viewingRulesPart).map(rule => (
                                    <li key={rule.id} className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 p-2 rounded">
                                        • {rule.description}
                                    </li>
                                ))}
                                {getRelevantRules(viewingRulesPart).length === 0 && (
                                    <li className="text-sm text-gray-500 italic">Nenhuma regra específica.</li>
                                )}
                            </ul>
                        </div>

                        <div className="flex justify-end">
                            <button onClick={() => setViewingRulesPart(null)} className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700">
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ManualAssignment;