import React from 'react';
import { render, screen } from '@testing-library/react';

// Mock para @google/genai (ESM puro)
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn(),
  Type: {}
}));
import App from '../App';

describe('App', () => {
  it('renderiza o loading quando IndexedDB não está disponível', () => {
    render(<App />);
    expect(screen.getByText(/Carregando banco de dados/i)).toBeInTheDocument();
  });
});
