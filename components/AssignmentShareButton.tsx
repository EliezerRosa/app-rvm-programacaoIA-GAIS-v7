import React from 'react';
import { Participation, Publisher } from '../types';
import { ShareIcon } from './icons';
import { generateIndividualAssignmentMessage, openWhatsApp } from '../lib/whatsappUtils';

interface AssignmentShareButtonProps {
    participation: Participation;
    publisher: Publisher | undefined;
    helper?: Publisher | undefined;
}

const AssignmentShareButton: React.FC<AssignmentShareButtonProps> = ({ participation, publisher, helper }) => {
    const handleShare = () => {
        if (!publisher) {
            alert('Publicador não encontrado.');
            return;
        }
        const message = generateIndividualAssignmentMessage(participation, publisher, helper);
        openWhatsApp(publisher.phone, message);
    };

    return (
        <button 
            onClick={handleShare} 
            className="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200 p-1"
            title="Enviar Designação via WhatsApp"
        >
            <ShareIcon className="w-5 h-5" />
        </button>
    );
};

export default AssignmentShareButton;
