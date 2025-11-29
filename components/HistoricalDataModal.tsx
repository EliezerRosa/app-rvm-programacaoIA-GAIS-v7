import React, { useState, useMemo, useEffect } from 'react';
import { ArrowUpTrayIcon, TrashIcon, Clock, DocumentIcon } from './icons';
import { HistoricalData, HistoricalImportRecord } from '../types';
import { getAllHistoricalImports, deleteHistoricalImport } from '../lib/storage';

interface HistoricalDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (data: HistoricalData[], fileNames?: string) => Promise<void>;
  existingWeeks: string[];
  parsePdf: (file: File) => Promise<HistoricalData[]>;
}

const HistoricalDataModal: React.FC<HistoricalDataModalProps> = ({ isOpen, onClose, onImport, existingWeeks, parsePdf }) => {
    const [activeTab, setActiveTab] = useState<'new' | 'saved'>('new');
    const [files, setFiles] = useState<File[]>([]); // Changed to array
    const [previewData, setPreviewData] = useState<HistoricalData[] | null>(null);
    const [isParsing, setIsParsing] = useState(false);
    const [error, setError] = useState('');
    const [savedImports, setSavedImports] = useState<HistoricalImportRecord[]>([]);
    const MAX_SIZE_MB = 10;

    useEffect(() => {
        if (isOpen) {
            loadSavedImports();
        }
    }, [isOpen, activeTab]);

    const loadSavedImports = async () => {
        try {
            const imports = await getAllHistoricalImports();
            setSavedImports(imports.sort((a, b) => new Date(b.importDate).getTime() - new Date(a.importDate).getTime()));
        } catch (e) {
            console.error("Erro ao carregar importações salvas:", e);
        }
    };

    const sortedExistingWeeks = useMemo(() => {
        return existingWeeks;
    }, [existingWeeks]);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = e.target.files;
        if (!selectedFiles || selectedFiles.length === 0) return;

        const filesArray = Array.from(selectedFiles);
        const validFiles: File[] = [];
        let hasError = false;

        // Validate files
        for (const file of filesArray) {
            if (file.type !== 'application/pdf') {
                setError(`O arquivo "${file.name}" não é um PDF.`);
                hasError = true;
                continue;
            }
            if (file.size > MAX_SIZE_MB * 1024 * 1024) {
                setError(`O arquivo "${file.name}" é muito grande (> ${MAX_SIZE_MB}MB).`);
                hasError = true;
                continue;
            }
            validFiles.push(file);
        }

        if (hasError && validFiles.length === 0) return; 
        if (hasError) setError('Alguns arquivos inválidos foram ignorados.');
        else setError('');

        setFiles(validFiles);
        setIsParsing(true);
        setPreviewData(null);

        try {
            const allParsedData: HistoricalData[] = [];
            const existingWeeksSet = new Set(existingWeeks);

            // Process sequentially
            for (const file of validFiles) {
                const parsed = await parsePdf(file);
                // Filter duplicates relative to DB AND current batch
                const uniqueInBatch = parsed.filter(d => {
                    const isNewInDb = !existingWeeksSet.has(d.weekId);
                    const isNewInBatch = !allParsedData.some( existing => existing.weekId === d.weekId);
                    return isNewInDb && isNewInBatch;
                });
                allParsedData.push(...uniqueInBatch);
            }
            
            setPreviewData(allParsedData);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Falha ao analisar os arquivos.');
            setPreviewData(null);
        } finally {
            setIsParsing(false);
        }
    };

    const handleImport = async () => {
        if (!previewData || previewData.length === 0) return;
        const fileNames = files.map(f => f.name).join(', ');
        await onImport(previewData, fileNames); 
        handleClose();
    };
    
    const handleLoadSaved = async (record: HistoricalImportRecord) => {
        if (window.confirm(`Deseja recarregar os dados de "${record.fileName}"?`)) {
             await onImport(record.data, undefined); // undefined filename = don't save as new record
             handleClose();
        }
    };

    const handleDeleteSaved = async (id: string) => {
        if (window.confirm("Tem certeza que deseja excluir este histórico salvo?")) {
            await deleteHistoricalImport(id);
            loadSavedImports();
        }
    };

    const handleClose = () => {
        setFiles([]);
        setPreviewData(null);
        setError('');
        setIsParsing(false);
        onClose();
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center" onClick={handleClose}>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-3xl m-4 flex flex-col" style={{maxHeight: '90vh'}} onClick={e => e.stopPropagation()}>
                <div className="p-6 pb-0 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex justify-between items-start mb-4">
                         <div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Histórico de Pautas</h2>
                            <p className="text-sm text-gray-500 mt-1">Importe múltiplas apostilas antigas de uma vez.</p>
                         </div>
                         <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">✕</button>
                    </div>
                    
                    <div className="flex space-x-4">
                        <button 
                            onClick={() => setActiveTab('new')}
                            className={`pb-2 text-sm font-medium border-b-2 ${activeTab === 'new' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                        >
                            Nova Importação (Lote)
                        </button>
                        <button 
                            onClick={() => setActiveTab('saved')}
                            className={`pb-2 text-sm font-medium border-b-2 ${activeTab === 'saved' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                        >
                            Importações Salvas
                        </button>
                    </div>
                </div>

                <div className="p-6 flex-grow overflow-y-auto">
                    {activeTab === 'new' ? (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                        <ArrowUpTrayIcon className="mx-auto h-10 w-10 text-gray-400" />
                                        <label htmlFor="pdf-upload-multi" className="mt-2 cursor-pointer block">
                                            <span className="text-indigo-600 font-medium hover:text-indigo-500">Selecione arquivos PDF</span>
                                            <input id="pdf-upload-multi" type="file" accept="application/pdf" multiple onChange={handleFileChange} className="sr-only"/>
                                            <p className="text-xs text-gray-500 mt-1">Você pode selecionar vários arquivos.</p>
                                        </label>
                                    </div>

                                    {files.length > 0 && (
                                        <div className="bg-gray-50 dark:bg-gray-700/30 p-3 rounded text-sm">
                                            <p className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Arquivos Selecionados ({files.length}):</p>
                                            <ul className="space-y-1 max-h-24 overflow-y-auto">
                                                {files.map((f, i) => (
                                                    <li key={i} className="text-xs text-gray-600 dark:text-gray-400 flex items-center truncate">
                                                        <DocumentIcon className="w-3 h-3 mr-1 flex-shrink-0"/> {f.name}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {isParsing && <p className="text-sm text-indigo-600 animate-pulse text-center">Analisando arquivos em lote...</p>}
                                    {error && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>}

                                    {previewData && (
                                        <div className="space-y-2">
                                            <h3 className="text-md font-semibold text-green-700 dark:text-green-400 flex items-center">
                                                ✓ {previewData.length} Semanas Novas Encontradas
                                            </h3>
                                            {previewData.length > 0 && (
                                                <ul className="text-xs bg-green-50 dark:bg-green-900/20 p-2 rounded max-h-32 overflow-y-auto text-gray-600 dark:text-gray-300 border border-green-100 dark:border-green-800">
                                                    {previewData.map(d => <li key={d.weekId} className="py-0.5 border-b border-green-100 dark:border-green-800 last:border-0">{d.weekDisplay}</li>)}
                                                </ul>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200">Já no Banco de Dados</h3>
                                    <div className="bg-gray-50 dark:bg-gray-900/50 p-3 rounded-md border border-gray-200 dark:border-gray-700 h-full max-h-96 overflow-y-auto">
                                        {sortedExistingWeeks.length > 0 ? (
                                            <ul className="space-y-1">
                                                {sortedExistingWeeks.map(week => (
                                                    <li key={week} className="text-xs text-gray-500 dark:text-gray-500">{week}</li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="text-xs text-gray-500 text-center mt-10">Nenhuma pauta no histórico.</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {savedImports.length === 0 ? (
                                <p className="text-center text-gray-500 py-8">Nenhum histórico salvo encontrado.</p>
                            ) : (
                                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                                    {savedImports.map(record => (
                                        <li key={record.id} className="py-4 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700/50 px-2 rounded">
                                            <div className="overflow-hidden mr-4">
                                                <p className="font-medium text-gray-900 dark:text-gray-100 truncate" title={record.fileName}>{record.fileName}</p>
                                                <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center mt-1">
                                                    <Clock className="w-3 h-3 mr-1" /> 
                                                    {formatDate(record.importDate)}
                                                </div>
                                                <p className="text-xs text-gray-400 mt-1">{record.data.length} semanas</p>
                                            </div>
                                            <div className="flex space-x-2 flex-shrink-0">
                                                <button 
                                                    onClick={() => handleLoadSaved(record)}
                                                    className="px-3 py-1 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 shadow-sm"
                                                >
                                                    Carregar
                                                </button>
                                                <button 
                                                    onClick={() => handleDeleteSaved(record.id)}
                                                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                                                    title="Excluir do histórico"
                                                >
                                                    <TrashIcon className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>

                {activeTab === 'new' && (
                    <div className="p-6 pt-4 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-3">
                        <button type="button" onClick={handleClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-md hover:bg-gray-50 dark:hover:bg-gray-500">Cancelar</button>
                        <button onClick={handleImport} disabled={!previewData || previewData.length === 0 || isParsing} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md disabled:bg-indigo-300 disabled:cursor-not-allowed flex items-center hover:bg-indigo-700 shadow-sm">
                            <ArrowUpTrayIcon className="w-4 h-4 mr-2" />
                            Confirmar Importação ({previewData ? previewData.length : 0})
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default HistoricalDataModal;
