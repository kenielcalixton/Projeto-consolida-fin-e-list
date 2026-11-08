import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getNextStage,
  getPreviousStage,
  isStockCritical,
  calculateGoalProgress,
  calculatePriceStats,
  confirmCartCheckout,
  revertConfirmedCheckout,
  adjustItemStock,
  returnConfirmedToStock,
  calculateGoalFinalReport,
  addGoalDeposit,
  convertWishToGoal,
  filterAcceptedWorkspaces,
  filterPendingInvitations,
  validateCategoryInGroup,
} from './stateMachine';
import { AcquisitionItem, TaxonomyGroup, Workspace } from '../types';

test('Recurring state machine advances and reverts accurately', () => {
  assert.equal(getNextStage('recorrente', 'estoque'), 'comprar');
  assert.equal(getNextStage('recorrente', 'comprar'), 'carrinho');
  assert.equal(getNextStage('recorrente', 'carrinho'), 'conferido');
  assert.equal(getNextStage('recorrente', 'conferido'), null);

  assert.equal(getPreviousStage('recorrente', 'conferido'), 'carrinho');
  assert.equal(getPreviousStage('recorrente', 'estoque'), null);
});

test('Stock critical alert triggers when currentStock <= minStock', () => {
  assert.equal(isStockCritical({ currentStock: 1, minStock: 2 }), true);
  assert.equal(isStockCritical({ currentStock: 2, minStock: 2 }), true);
  assert.equal(isStockCritical({ currentStock: 5, minStock: 2 }), false);
});

test('Confirming cart checkout increments stock and records product purchase history', () => {
  const initialItem: AcquisitionItem = {
    id: 'item_arroz',
    listId: 'list_1',
    workspaceId: 'ws_1',
    name: 'Arroz Branco 5kg',
    groupId: 'grp_mercearia',
    categoryId: 'cat_graos',
    listType: 'recorrente',
    stage: 'carrinho',
    acceptedMemberEmails: ['admin@teste.com'],
    currentStock: 1,
    minStock: 2,
    unit: 'pct',
    productsHistory: [],
    updatedAt: '2026-10-01T10:00:00.000Z',
  };

  const { updatedItem, newProduct } = confirmCartCheckout(initialItem, {
    brand: 'Tio João',
    unitPrice: 25.5,
    quantity: 3,
    storeName: 'Mercado Extra',
  });

  assert.equal(updatedItem.stage, 'conferido');
  assert.equal(updatedItem.currentStock, 4);
  assert.equal(newProduct.totalPrice, 76.5);
  assert.equal(updatedItem.productsHistory.length, 1);
  assert.equal(updatedItem.productsHistory[0].brand, 'Tio João');

  const stats = calculatePriceStats(updatedItem.productsHistory);
  assert.equal(stats.lastPrice, 25.5);
  assert.equal(stats.lowestPrice, 25.5);

  const reverted = revertConfirmedCheckout(updatedItem);
  assert.equal(reverted.stage, 'carrinho');
  assert.equal(reverted.currentStock, 1);
});

test('Goal deposit updates saved amount, progress bar, and transitions to pronto when target met', () => {
  const goalItem: AcquisitionItem = {
    id: 'item_geladeira',
    listId: 'list_goal',
    workspaceId: 'ws_1',
    name: 'Geladeira Inverter Frost Free',
    groupId: 'grp_eletro',
    categoryId: 'cat_cozinha',
    listType: 'objetivo',
    stage: 'poupando',
    acceptedMemberEmails: ['admin@teste.com'],
    targetAmount: 4000,
    savedAmount: 3500,
    deposits: [],
    productsHistory: [],
    updatedAt: '2026-10-01T10:00:00.000Z',
  };

  assert.equal(calculateGoalProgress(goalItem.savedAmount, goalItem.targetAmount), 88);

  const afterDeposit = addGoalDeposit(goalItem, 500, 'admin@teste.com', 'Aporte de novembro');
  assert.equal(afterDeposit.savedAmount, 4000);
  assert.equal(afterDeposit.stage, 'pronto');
  assert.equal(calculateGoalProgress(afterDeposit.savedAmount, afterDeposit.targetAmount), 100);
});

test('Wish to Goal conversion archives the wish and creates a research goal card', () => {
  const wishItem: AcquisitionItem = {
    id: 'item_wish_1',
    listId: 'list_wish',
    workspaceId: 'ws_1',
    name: 'Cadeira Ergonômica Mesh',
    groupId: 'grp_casa',
    categoryId: 'cat_escritorio',
    listType: 'desejo',
    stage: 'avaliando',
    acceptedMemberEmails: ['admin@teste.com'],
    estimatedPrice: 1850,
    priority: 'Alta',
    inspirationUrl: 'https://loja.exemplo.com/cadeira',
    prosAndCons: 'Excelente apoio lombar, garantia de 5 anos',
    productsHistory: [],
    updatedAt: '2026-10-01T10:00:00.000Z',
  };

  const { convertedGoalItem, updatedWishItem } = convertWishToGoal(wishItem, 'list_goal_1');
  assert.equal(updatedWishItem.stage, 'arquivado');
  assert.equal(updatedWishItem.convertedToGoalItemId, convertedGoalItem.id);
  assert.equal(convertedGoalItem.listType, 'objetivo');
  assert.equal(convertedGoalItem.stage, 'pesquisa');
  assert.equal(convertedGoalItem.targetAmount, 1850);
  assert.equal(convertedGoalItem.quotes?.length, 1);
});

test('ACL filtering strictly returns workspaces where user is Aceito vs Pendente', () => {
  const workspaces: Workspace[] = [
    {
      id: 'ws_accepted',
      name: 'Residência Central',
      description: 'Compras da família',
      type: 'Compartilhado',
      ownerUid: 'wAUPqTjSmOMV3S8XlaLlv46QK463',
      ownerEmail: 'user@teste.com',
      acceptedMemberEmails: ['user@teste.com'],
      acceptedMemberUids: ['wAUPqTjSmOMV3S8XlaLlv46QK463'],
      members: [{ email: 'user@teste.com', role: 'Admin', status: 'Aceito' }],
      createdAt: '2026-10-01',
    },
    {
      id: 'ws_pending',
      name: 'Churrasco Fim de Ano',
      description: 'Rateio entre amigos',
      type: 'Compartilhado',
      ownerUid: 'other_uid',
      ownerEmail: 'amigo@teste.com',
      acceptedMemberEmails: ['amigo@teste.com'],
      acceptedMemberUids: ['other_uid'],
      members: [
        { email: 'amigo@teste.com', role: 'Admin', status: 'Aceito' },
        { email: 'user@teste.com', role: 'Membro', status: 'Pendente' },
      ],
      createdAt: '2026-10-02',
    },
  ];

  const accepted = filterAcceptedWorkspaces(workspaces, 'user@teste.com');
  const pending = filterPendingInvitations(workspaces, 'user@teste.com');

  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].id, 'ws_accepted');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, 'ws_pending');
});

test('Taxonomy validation enforces category encapsulation inside parent group', () => {
  const groups: TaxonomyGroup[] = [
    {
      id: 'grp_1',
      name: 'Supermercado & Despensa',
      code: 'SUP',
      description: 'Itens alimentícios',
      categories: [{ id: 'cat_1', groupId: 'grp_1', name: 'Mercearia Seca' }],
    },
  ];

  assert.equal(validateCategoryInGroup(groups, 'grp_1', 'cat_1'), true);
  assert.equal(validateCategoryInGroup(groups, 'grp_1', 'cat_999'), false);
});

test('Consuming stock in Estoque can automatically move item to A Comprar when critical', () => {
  const item: AcquisitionItem = {
    id: 'item_azeite',
    listId: 'list_1',
    workspaceId: 'ws_1',
    name: 'Azeite Extra Virgem',
    groupId: 'grp_1',
    categoryId: 'cat_1',
    listType: 'recorrente',
    stage: 'estoque',
    acceptedMemberEmails: ['user@teste.com'],
    currentStock: 2,
    minStock: 1,
    unit: 'un',
    productsHistory: [],
    updatedAt: '2026-11-01T10:00:00.000Z',
  };

  const afterConsumption = adjustItemStock(item, -1, true);
  assert.equal(afterConsumption.currentStock, 1);
  assert.equal(afterConsumption.stage, 'comprar');
});

test('Return confirmed item to stock closes the cycle while keeping updated balance', () => {
  const item: AcquisitionItem = {
    id: 'item_leite',
    listId: 'list_1',
    workspaceId: 'ws_1',
    name: 'Leite Integral',
    groupId: 'grp_1',
    categoryId: 'cat_1',
    listType: 'recorrente',
    stage: 'conferido',
    acceptedMemberEmails: ['user@teste.com'],
    currentStock: 12,
    minStock: 6,
    cartDraft: { brand: 'Piracanjuba', unitPrice: 5.49, quantity: 12, storeName: 'Atacadão' },
    productsHistory: [],
    updatedAt: '2026-11-05T10:00:00.000Z',
  };

  const returned = returnConfirmedToStock(item);
  assert.equal(returned.stage, 'estoque');
  assert.equal(returned.currentStock, 12);
  assert.equal(returned.cartDraft, undefined);
});

test('Goal Final Report accurately calculates difference between paid and saved/budgeted amounts', () => {
  const acquiredGoal: AcquisitionItem = {
    id: 'item_forno',
    listId: 'list_goal',
    workspaceId: 'ws_1',
    name: 'Forno de Embutir',
    groupId: 'grp_1',
    categoryId: 'cat_1',
    listType: 'objetivo',
    stage: 'adquirido',
    acceptedMemberEmails: ['user@teste.com'],
    targetAmount: 2600,
    savedAmount: 2600,
    finalPaidAmount: 2390,
    productsHistory: [],
    updatedAt: '2026-10-28T10:00:00.000Z',
  };

  const report = calculateGoalFinalReport(acquiredGoal);
  assert.equal(report.budgetedAmount, 2600);
  assert.equal(report.paidAmount, 2390);
  assert.equal(report.differenceFromBudget, 210);
  assert.equal(report.status, 'economia');
});

