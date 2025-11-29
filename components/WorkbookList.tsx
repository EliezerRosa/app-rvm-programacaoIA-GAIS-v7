

import React, { useState } from 'react';
import { Workbook } from '../types';
import { EyeIcon, TrashIcon, DocumentTextIcon, PencilIcon, ArrowPathIcon, ArchiveBoxIcon } from './icons';

interface WorkbookListProps {
  workbooks: Workbook[];
  onDelete: (workbook: Workbook) => void; // This will be the permanent delete for trash items
  onSoftDelete: (workbook: Workbook) => void; // Move to trash
  onRestore: (workbook: Workbook) => void; // Restore from trash
  onEdit: (workbook: Workbook) => void;
}

const WorkbookList: React.FC<WorkbookListProps> = ({ workbooks, onDelete, onSoftDelete, onRestore, onEdit }) => {
  const [activeTab, setActiveTab] = useState<'active' | 'trash'>('active');

  const activeWorkbooks = workbooks.filter(w => !w.isDeleted).sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());
  const deletedWorkbooks = workbooks.filter(w => w.isDeleted).sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());

  const handleView = (workbook: Workbook) => {
    try {
      const byteCharacters = atob(workbook.fileData);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const file = new Blob([byteArray], { type: 'application/pdf' });
      const fileURL = URL.createObjectURL(file);
      window.open(fileURL, '_blank');
    } catch (e) {
      console.error("Error opening PDF", e);
      alert("Não foi possível abrir o PDF. O arquivo pode estar corrompido.");
    }
  };
  
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
  }

  return (
    <div className="bg-white dark:bg-gray-800 shadow-md rounded-lg overflow-hidden">
      {/* Tabs Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 px-4">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          <button
            onClick={() => setActiveTab('active')}
            className={`${
              activeTab === 'active'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <DocumentTextIcon className="w-4 h-4 mr-2"/>
            Apostilas Ativas ({activeWorkbooks.length})
          </button>
          <button
            onClick={() => setActiveTab('trash')}
            className={`${
              activeTab === 'trash'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <ArchiveBoxIcon className="w-4 h-4 mr-2"/>
            Lixeira ({deletedWorkbooks.length})
          </button>
        </nav>
      </div>

      {/* Content */}
      <ul className="divide-y divide-gray-200 dark:divide-gray-700">
        {(activeTab === 'active' ? activeWorkbooks : deletedWorkbooks).map((workbook) => (
          <li key={workbook.id} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className={`flex-shrink-0 h-10 w-10 ${activeTab === 'active' ? 'text-indigo-600' : 'text-gray-400'}`}>
                  <DocumentTextIcon />
                </div>
                <div className="ml-3">
                  <p className={`text-sm font-medium ${activeTab === 'active' ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400 line-through'}`}>
                    {workbook.name}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Upload em: {formatDate(workbook.uploadDate)}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {activeTab === 'active' && (
                  <>
                    <button onClick={() => handleView(workbook)} className="p-2 text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-500" title="Visualizar PDF">
                      <EyeIcon className="w-5 h-5" />
                    </button>
                    <button onClick={() => onEdit(workbook)} className="p-2 text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-500" title="Editar Nome">
                      <PencilIcon className="w-5 h-5" />
                    </button>
                    <button onClick={() => onSoftDelete(workbook)} className="p-2 text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400" title="Mover para Lixeira">
                      <TrashIcon className="w-5 h-5" />
                    </button>
                  </>
                )}
                
                {activeTab === 'trash' && (
                  <>
                    <button onClick={() => onRestore(workbook)} className="p-2 text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200" title="Restaurar">
                      <ArrowPathIcon className="w-5 h-5" />
                    </button>
                    <button onClick={() => onDelete(workbook)} className="p-2 text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-200" title="Excluir Permanentemente">
                      <TrashIcon className="w-5 h-5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </li>
        ))}
        {(activeTab === 'active' ? activeWorkbooks : deletedWorkbooks).length === 0 && (
            <li className="p-8 text-center text-gray-500 dark:text-gray-400 text-sm">
                {activeTab === 'active' ? 'Nenhuma apostila ativa.' : 'A lixeira está vazia.'}
            </li>
        )}
      </ul>
    </div>
  );
};

export default WorkbookList;
