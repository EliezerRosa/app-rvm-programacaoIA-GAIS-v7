import { render, screen } from '@testing-library/react';
import PublisherTable from '../components/PublisherTable';

describe('PublisherTable', () => {
  it('renderiza lista de publicadores', () => {
    const publishers = [
      { id: '1', name: 'João', condition: 'Ativo' },
      { id: '2', name: 'Maria', condition: 'Inativo' },
    ];
    render(<PublisherTable publishers={publishers} onEdit={() => {}} onDelete={() => {}} />);
    // Verifica se pelo menos um elemento com o nome existe
    expect(screen.getAllByText('João').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Maria').length).toBeGreaterThan(0);
  });
});
