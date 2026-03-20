import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ActionPanel from '../components/ActionPanel';

const basePlayer = { id: 'p1', role: 'villager', alive: true };

describe('ActionPanel PK投票约束', () => {
  it('pk_voting阶段PK候选人看不到投票按钮', () => {
    const { container } = render(
      <ActionPanel
        phase="pk_voting"
        myPlayer={basePlayer}
        selectedTarget={null}
        onAction={vi.fn()}
        witchPotions={{ antidote: true, poison: true }}
        gameState={{}}
        pkCandidates={['p1', 'p2']}
        myPlayerId="p1"
      />
    );
    // ActionPanel should return null for PK candidate
    expect(container.innerHTML).toBe('');
  });

  it('pk_voting阶段非候选人可以看到投票按钮', () => {
    render(
      <ActionPanel
        phase="pk_voting"
        myPlayer={basePlayer}
        selectedTarget={null}
        onAction={vi.fn()}
        witchPotions={{ antidote: true, poison: true }}
        gameState={{}}
        pkCandidates={['p2', 'p3']}
        myPlayerId="p1"
      />
    );
    expect(screen.getByText('投票放逐')).toBeInTheDocument();
  });

  it('voting阶段所有存活玩家可以投票', () => {
    render(
      <ActionPanel
        phase="voting"
        myPlayer={basePlayer}
        selectedTarget="p2"
        onAction={vi.fn()}
        witchPotions={{ antidote: true, poison: true }}
        gameState={{}}
        pkCandidates={[]}
        myPlayerId="p1"
      />
    );
    expect(screen.getByText('投票放逐')).toBeInTheDocument();
  });
});
