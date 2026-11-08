import { useEffect, useState } from 'react';
import {
  AcquisitionItem,
  AcquisitionList,
  GoalQuote,
  ItemStage,
  ListType,
  TaxonomyGroup,
  UserProfile,
  Workspace,
} from './types';
import {
  DEFAULT_USER_PROFILE,
  INITIAL_ITEMS,
  INITIAL_LISTS,
  INITIAL_TAXONOMY_GROUPS,
  INITIAL_WORKSPACES,
} from './data/seedData';
import {
  addGoalDeposit,
  adjustItemStock,
  confirmCartCheckout,
  convertWishToGoal,
  getStagesForListType,
  returnConfirmedToStock,
  revertConfirmedCheckout,
} from './utils/stateMachine';
import {
  ADMIN_USER_UID,
  deleteItemFromFirestore,
  deleteListFromFirestore,
  deleteTaxonomyGroupFromFirestore,
  deleteWorkspaceFromFirestore,
  fetchAcceptedWorkspacesFromFirestore,
  recordProductInSubcollection,
  saveItemToFirestore,
  saveListToFirestore,
  saveTaxonomyGroupToFirestore,
  saveWorkspaceToFirestore,
  subscribeToAuthChanges,
  upsertUserDocument,
  logoutFirebase,
} from './services/firebase';
import { DashboardOverviewView } from './components/DashboardOverviewView';
import { HubDashboardView } from './components/HubDashboardView';
import { WorkspaceBoardView } from './components/WorkspaceBoardView';
import { SettingsView } from './components/SettingsView';
import { AuthScreenView } from './components/AuthScreenView';
import { AdminEnvironmentView } from './components/AdminEnvironmentView';
import {
  Moon,
  Sun,
  LayoutDashboard,
  FolderKanban,
  Settings,
  ShieldCheck,
  LogOut,
} from 'lucide-react';

type ActiveRoute =
  | 'dashboard'
  | 'workspaces'
  | 'workspace_detail'
  | 'settings'
  | 'admin';

export default function App() {
  // Theme State (Light / Dark Mode toggle in header without reloading)
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('app_aquisicoes_theme');
    return saved === 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
      localStorage.setItem('app_aquisicoes_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('app_aquisicoes_theme', 'light');
    }
  }, [isDarkMode]);

  // Auth & User Profile State (Login is the first screen until authenticated)
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return sessionStorage.getItem('app_aquisicoes_auth_session') === 'true';
  });

  const [currentUser, setCurrentUser] = useState<UserProfile>(() => {
    const saved = localStorage.getItem('app_aquisicoes_user');
    return saved ? JSON.parse(saved) : DEFAULT_USER_PROFILE;
  });

  // Core Application State (with localStorage persistence + Firestore sync)
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => {
    const saved = localStorage.getItem('app_aquisicoes_workspaces');
    return saved ? JSON.parse(saved) : INITIAL_WORKSPACES;
  });

  const [lists, setLists] = useState<AcquisitionList[]>(() => {
    const saved = localStorage.getItem('app_aquisicoes_lists');
    return saved ? JSON.parse(saved) : INITIAL_LISTS;
  });

  const [items, setItems] = useState<AcquisitionItem[]>(() => {
    const saved = localStorage.getItem('app_aquisicoes_items');
    return saved ? JSON.parse(saved) : INITIAL_ITEMS;
  });

  const [taxonomyGroups, setTaxonomyGroups] = useState<TaxonomyGroup[]>(() => {
    const saved = localStorage.getItem('app_aquisicoes_taxonomy');
    return saved ? JSON.parse(saved) : INITIAL_TAXONOMY_GROUPS;
  });

  // Navigation State: Default to 'dashboard' (with alerts & invitations)
  const [activeRoute, setActiveRoute] = useState<ActiveRoute>('dashboard');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('ws_residencia');

  // Persist changes locally
  useEffect(() => {
    localStorage.setItem('app_aquisicoes_user', JSON.stringify(currentUser));
  }, [currentUser]);

  useEffect(() => {
    localStorage.setItem('app_aquisicoes_workspaces', JSON.stringify(workspaces));
  }, [workspaces]);

  useEffect(() => {
    localStorage.setItem('app_aquisicoes_lists', JSON.stringify(lists));
  }, [lists]);

  useEffect(() => {
    localStorage.setItem('app_aquisicoes_items', JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    localStorage.setItem('app_aquisicoes_taxonomy', JSON.stringify(taxonomyGroups));
  }, [taxonomyGroups]);

  // Subscribe to Firebase Auth changes & attempt Firestore ACL sync
  useEffect(() => {
    const unsub = subscribeToAuthChanges((firebaseUser) => {
      if (firebaseUser) {
        setCurrentUser(firebaseUser);
        sessionStorage.setItem('app_aquisicoes_auth_session', 'true');
        setIsAuthenticated(true);
      }
    });
    return () => unsub();
  }, []);

  const handleLogout = async () => {
    try {
      await logoutFirebase();
    } catch {
      // Ignore offline sign-out errors
    }
    sessionStorage.removeItem('app_aquisicoes_auth_session');
    setIsAuthenticated(false);
    setActiveRoute('dashboard');
  };

  useEffect(() => {
    fetchAcceptedWorkspacesFromFirestore(currentUser.email)
      .then((remoteWorkspaces) => {
        if (remoteWorkspaces && remoteWorkspaces.length > 0) {
          setWorkspaces((prev) => {
            const byId = new Map(prev.map((w) => [w.id, w]));
            remoteWorkspaces.forEach((rw) => byId.set(rw.id, rw));
            return Array.from(byId.values());
          });
        }
      })
      .catch(() => {
        // Offline / external console rules fallback
      });
  }, [currentUser.email]);

  // =========================================================================
  // USER PROFILE & WORKSPACE HANDLERS
  // =========================================================================
  const handleUserChange = (newProfile: UserProfile) => {
    setCurrentUser(newProfile);
    const targetEmail = newProfile.email.toLowerCase();
    setWorkspaces((prev) =>
      prev.map((ws) => {
        const hasMember = ws.members.some((m) => m.email.toLowerCase() === targetEmail);
        if (!hasMember) return ws;
        const updatedWs: Workspace = {
          ...ws,
          members: ws.members.map((m) =>
            m.email.toLowerCase() === targetEmail
              ? { ...m, name: newProfile.displayName }
              : m
          ),
        };
        saveWorkspaceToFirestore(updatedWs);
        return updatedWs;
      })
    );
  };

  const handleUpdateUserName = (newName: string) => {
    const cleanName = newName.trim();
    if (!cleanName) return;
    const updatedProfile: UserProfile = {
      ...currentUser,
      displayName: cleanName,
    };
    upsertUserDocument(updatedProfile);
    handleUserChange(updatedProfile);
  };

  const handleSelectWorkspace = (workspaceId: string) => {
    setSelectedWorkspaceId(workspaceId);
    setActiveRoute('workspace_detail');
  };

  const handleCreateWorkspace = (
    name: string,
    description: string,
    type: 'Individual' | 'Compartilhado',
    budget: number,
    invitedEmails: string[],
    creatorName?: string
  ) => {
    const now = new Date().toISOString();
    const wsId = `ws_${Date.now()}`;
    const ownerEmail = currentUser.email.toLowerCase();
    const ownerName = creatorName?.trim() || currentUser.displayName || ownerEmail.split('@')[0];

    const members = [
      {
        uid: currentUser.uid,
        email: ownerEmail,
        name: ownerName,
        role: 'Admin' as const,
        status: 'Aceito' as const,
        respondedAt: now,
      },
      ...invitedEmails.map((em) => ({
        email: em,
        name: em.split('@')[0],
        role: 'Membro' as const,
        status: 'Pendente' as const,
      })),
    ];

    const newWs: Workspace = {
      id: wsId,
      name,
      description,
      type,
      ownerUid: currentUser.uid,
      ownerEmail,
      acceptedMemberEmails: [ownerEmail],
      acceptedMemberUids: [currentUser.uid],
      members,
      monthlyBudget: budget,
      createdAt: now,
    };

    const defaultLists: AcquisitionList[] = [
      {
        id: `list_rec_${Date.now()}`,
        workspaceId: wsId,
        name: 'Lista Recorrente Principal',
        type: 'recorrente',
        description: 'Controle de estoque mínimo e reposição.',
        acceptedMemberEmails: [ownerEmail],
        createdAt: now,
      },
      {
        id: `list_obj_${Date.now() + 1}`,
        workspaceId: wsId,
        name: 'Objetivos Financeiros',
        type: 'objetivo',
        description: 'Metas de poupança e cotações.',
        acceptedMemberEmails: [ownerEmail],
        createdAt: now,
      },
      {
        id: `list_des_${Date.now() + 2}`,
        workspaceId: wsId,
        name: 'Lista de Desejos',
        type: 'desejo',
        description: 'Ideias e avaliações de compra.',
        acceptedMemberEmails: [ownerEmail],
        createdAt: now,
      },
    ];

    setWorkspaces((prev) => [newWs, ...prev]);
    setLists((prev) => [...defaultLists, ...prev]);
    saveWorkspaceToFirestore(newWs);
    defaultLists.forEach((l) => saveListToFirestore(l));
  };

  const handleUpdateWorkspace = (
    workspaceId: string,
    name: string,
    description: string,
    type: 'Individual' | 'Compartilhado',
    budget: number
  ) => {
    setWorkspaces((prev) =>
      prev.map((ws) => {
        if (ws.id !== workspaceId) return ws;
        const updatedWs: Workspace = {
          ...ws,
          name,
          description,
          type,
          monthlyBudget: budget,
        };
        saveWorkspaceToFirestore(updatedWs);
        return updatedWs;
      })
    );
  };

  const handleDeleteWorkspace = (workspaceId: string) => {
    setWorkspaces((prev) => prev.filter((ws) => ws.id !== workspaceId));
    setLists((prev) => prev.filter((l) => l.workspaceId !== workspaceId));
    setItems((prev) => prev.filter((i) => i.workspaceId !== workspaceId));
    deleteWorkspaceFromFirestore(workspaceId);
    if (selectedWorkspaceId === workspaceId) {
      setActiveRoute('workspaces');
    }
  };

  const handleAcceptInvitation = (workspaceId: string) => {
    const userEmail = currentUser.email.toLowerCase();
    const now = new Date().toISOString();

    setWorkspaces((prev) =>
      prev.map((ws) => {
        if (ws.id !== workspaceId) return ws;
        const updatedMembers = ws.members.map((m) =>
          m.email.toLowerCase() === userEmail
            ? { ...m, uid: currentUser.uid, status: 'Aceito' as const, respondedAt: now }
            : m
        );
        const acceptedEmails = Array.from(
          new Set([...ws.acceptedMemberEmails, userEmail])
        );
        const acceptedUids = Array.from(
          new Set([...(ws.acceptedMemberUids || []), currentUser.uid])
        );
        const updatedWs: Workspace = {
          ...ws,
          members: updatedMembers,
          acceptedMemberEmails: acceptedEmails,
          acceptedMemberUids: acceptedUids,
        };
        saveWorkspaceToFirestore(updatedWs);
        return updatedWs;
      })
    );
  };

  const handleRejectInvitation = (
    workspaceId: string,
    reason: string,
    note: string
  ) => {
    const userEmail = currentUser.email.toLowerCase();
    const now = new Date().toISOString();

    setWorkspaces((prev) =>
      prev.map((ws) => {
        if (ws.id !== workspaceId) return ws;
        const updatedMembers = ws.members.map((m) =>
          m.email.toLowerCase() === userEmail
            ? {
                ...m,
                status: 'Recusado' as const,
                rejectionReason: reason,
                rejectionNote: note,
                respondedAt: now,
              }
            : m
        );
        const updatedWs: Workspace = {
          ...ws,
          members: updatedMembers,
        };
        saveWorkspaceToFirestore(updatedWs);
        return updatedWs;
      })
    );
  };

  const handleInviteMembersToWorkspace = (
    workspaceId: string,
    emails: string[]
  ) => {
    setWorkspaces((prev) =>
      prev.map((ws) => {
        if (ws.id !== workspaceId) return ws;
        const existingEmails = new Set(
          ws.members.map((m) => m.email.toLowerCase())
        );
        const newMembers = emails
          .filter((em) => !existingEmails.has(em.toLowerCase()))
          .map((em) => ({
            email: em.toLowerCase(),
            name: em.split('@')[0],
            role: 'Membro' as const,
            status: 'Pendente' as const,
          }));
        const updatedWs: Workspace = {
          ...ws,
          members: [...ws.members, ...newMembers],
        };
        saveWorkspaceToFirestore(updatedWs);
        return updatedWs;
      })
    );
  };

  const handleUpdateMemberStatus = (
    workspaceId: string,
    email: string,
    status: 'Pendente' | 'Aceito' | 'Recusado'
  ) => {
    const targetEmail = email.toLowerCase();
    setWorkspaces((prev) =>
      prev.map((ws) => {
        if (ws.id !== workspaceId) return ws;
        const updatedMembers = ws.members.map((m) =>
          m.email.toLowerCase() === targetEmail ? { ...m, status } : m
        );
        const acceptedEmails = updatedMembers
          .filter((m) => m.status === 'Aceito')
          .map((m) => m.email.toLowerCase());

        const updatedWs: Workspace = {
          ...ws,
          members: updatedMembers,
          acceptedMemberEmails: acceptedEmails,
        };
        saveWorkspaceToFirestore(updatedWs);
        return updatedWs;
      })
    );
  };

  const handleRemoveMember = (workspaceId: string, email: string) => {
    const targetEmail = email.toLowerCase();
    setWorkspaces((prev) =>
      prev.map((ws) => {
        if (ws.id !== workspaceId) return ws;
        const updatedMembers = ws.members.filter(
          (m) => m.email.toLowerCase() !== targetEmail
        );
        const acceptedEmails = updatedMembers
          .filter((m) => m.status === 'Aceito')
          .map((m) => m.email.toLowerCase());

        const updatedWs: Workspace = {
          ...ws,
          members: updatedMembers,
          acceptedMemberEmails: acceptedEmails,
        };
        saveWorkspaceToFirestore(updatedWs);
        return updatedWs;
      })
    );
  };

  // =========================================================================
  // LIST & ITEM STATE MACHINE HANDLERS (CREATE, EDIT, DELETE)
  // =========================================================================
  const handleCreateList = (
    workspaceId: string,
    name: string,
    type: ListType,
    description: string
  ) => {
    const ws = workspaces.find((w) => w.id === workspaceId);
    const newList: AcquisitionList = {
      id: `list_${type}_${Date.now()}`,
      workspaceId,
      name,
      type,
      description,
      acceptedMemberEmails: ws?.acceptedMemberEmails || [currentUser.email],
      createdAt: new Date().toISOString(),
    };
    setLists((prev) => [...prev, newList]);
    saveListToFirestore(newList);
  };

  const handleUpdateList = (
    listId: string,
    name: string,
    type: ListType,
    description: string
  ) => {
    setLists((prev) =>
      prev.map((l) => {
        if (l.id !== listId) return l;
        const updatedList: AcquisitionList = {
          ...l,
          name,
          type,
          description,
        };
        saveListToFirestore(updatedList);
        return updatedList;
      })
    );

    // If list type changed, align child items to the new list type's initial stage
    const defaultStage = getStagesForListType(type)[0].id as ItemStage;
    setItems((prev) =>
      prev.map((item) => {
        if (item.listId !== listId || item.listType === type) return item;
        const updatedItem: AcquisitionItem = {
          ...item,
          listType: type,
          stage: defaultStage,
          updatedAt: new Date().toISOString(),
        };
        saveItemToFirestore(updatedItem);
        return updatedItem;
      })
    );
  };

  const handleDeleteList = (listId: string) => {
    setLists((prev) => prev.filter((l) => l.id !== listId));
    setItems((prev) => prev.filter((i) => i.listId !== listId));
    deleteListFromFirestore(listId);
  };

  const handleCreateItem = (
    newItemData: Omit<AcquisitionItem, 'id' | 'updatedAt' | 'productsHistory'>
  ) => {
    const newItem: AcquisitionItem = {
      ...newItemData,
      id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      productsHistory: [],
      updatedAt: new Date().toISOString(),
    };
    setItems((prev) => [newItem, ...prev]);
    saveItemToFirestore(newItem);
  };

  const handleUpdateItem = (updatedItem: AcquisitionItem) => {
    setItems((prev) =>
      prev.map((i) => (i.id === updatedItem.id ? updatedItem : i))
    );
    saveItemToFirestore(updatedItem);
  };

  const handleDeleteItem = (itemId: string) => {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    deleteItemFromFirestore(itemId);
  };

  const handleMoveItemStage = (item: AcquisitionItem, targetStage: ItemStage) => {
    if (
      item.listType === 'recorrente' &&
      item.stage === 'conferido' &&
      targetStage === 'carrinho'
    ) {
      const reverted = revertConfirmedCheckout(item);
      setItems((prev) => prev.map((i) => (i.id === item.id ? reverted : i)));
      saveItemToFirestore(reverted);
      return;
    }

    const updated: AcquisitionItem = {
      ...item,
      stage: targetStage,
      updatedAt: new Date().toISOString(),
    };
    setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    saveItemToFirestore(updated);
  };

  const handleConfirmCartCheckout = (
    item: AcquisitionItem,
    productInput: {
      brand: string;
      unitPrice: number;
      quantity: number;
      storeName: string;
      receiptUrl?: string;
    },
    advanceToConfirmed: boolean
  ) => {
    if (advanceToConfirmed) {
      const { updatedItem, newProduct } = confirmCartCheckout(item, productInput);
      setItems((prev) => prev.map((i) => (i.id === item.id ? updatedItem : i)));
      recordProductInSubcollection(updatedItem, newProduct);
    } else {
      const updatedItem: AcquisitionItem = {
        ...item,
        stage: 'carrinho',
        cartDraft: {
          brand: productInput.brand,
          unitPrice: productInput.unitPrice,
          quantity: productInput.quantity,
          storeName: productInput.storeName,
          receiptUrl: productInput.receiptUrl,
        },
        updatedAt: new Date().toISOString(),
      };
      setItems((prev) => prev.map((i) => (i.id === item.id ? updatedItem : i)));
      saveItemToFirestore(updatedItem);
    }
  };

  const handleAddGoalDeposit = (
    item: AcquisitionItem,
    amount: number,
    note: string
  ) => {
    const updated = addGoalDeposit(item, amount, currentUser.email, note);
    setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    saveItemToFirestore(updated);
  };

  const handleAddGoalQuote = (
    item: AcquisitionItem,
    quoteInput: Omit<GoalQuote, 'id' | 'recordedAt'>
  ) => {
    const newQuote: GoalQuote = {
      ...quoteInput,
      id: `quote_${Date.now()}`,
      recordedAt: new Date().toISOString(),
    };
    const updated: AcquisitionItem = {
      ...item,
      quotes: [newQuote, ...(item.quotes || [])],
      updatedAt: new Date().toISOString(),
    };
    setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    saveItemToFirestore(updated);
  };

  const handleDeleteGoalQuote = (item: AcquisitionItem, quoteId: string) => {
    const updated: AcquisitionItem = {
      ...item,
      quotes: (item.quotes || []).filter((q) => q.id !== quoteId),
      updatedAt: new Date().toISOString(),
    };
    setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    saveItemToFirestore(updated);
  };

  const handleCompleteGoalAcquisition = (
    item: AcquisitionItem,
    finalPaidAmount: number,
    storeName: string,
    brand: string
  ) => {
    const now = new Date().toISOString();
    const newProd = {
      id: `prod_goal_${Date.now()}`,
      itemId: item.id,
      brand,
      unitPrice: finalPaidAmount,
      quantity: 1,
      totalPrice: finalPaidAmount,
      storeName,
      purchaseDate: now,
    };
    const updated: AcquisitionItem = {
      ...item,
      stage: 'adquirido',
      finalPaidAmount,
      acquiredStore: storeName,
      acquiredDate: now,
      productsHistory: [newProd, ...(item.productsHistory || [])],
      updatedAt: now,
    };
    setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    recordProductInSubcollection(updated, newProd);
  };

  const handleConvertWishToGoal = (
    wishItem: AcquisitionItem,
    targetGoalListId: string
  ) => {
    const { convertedGoalItem, updatedWishItem } = convertWishToGoal(
      wishItem,
      targetGoalListId
    );
    setItems((prev) => [
      convertedGoalItem,
      ...prev.map((i) => (i.id === wishItem.id ? updatedWishItem : i)),
    ]);
    saveItemToFirestore(convertedGoalItem);
    saveItemToFirestore(updatedWishItem);
  };

  const handleAdjustItemStock = (
    item: AcquisitionItem,
    delta: number,
    autoMoveToBuyOnCritical: boolean
  ) => {
    const updated = adjustItemStock(item, delta, autoMoveToBuyOnCritical);
    setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    saveItemToFirestore(updated);
  };

  const handleReturnConfirmedToStock = (item: AcquisitionItem) => {
    const updated = returnConfirmedToStock(item);
    setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    saveItemToFirestore(updated);
  };

  // =========================================================================
  // GLOBAL TAXONOMY HANDLERS (CREATE, EDIT, DELETE)
  // =========================================================================
  const handleAddTaxonomyGroup = (
    name: string,
    code: string,
    description: string
  ) => {
    const newGrp: TaxonomyGroup = {
      id: `grp_${Date.now()}`,
      name,
      code,
      description,
      categories: [],
    };
    setTaxonomyGroups((prev) => [...prev, newGrp]);
    saveTaxonomyGroupToFirestore(newGrp);
  };

  const handleUpdateTaxonomyGroup = (
    groupId: string,
    name: string,
    code: string,
    description: string
  ) => {
    setTaxonomyGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        const updated = { ...g, name, code, description };
        saveTaxonomyGroupToFirestore(updated);
        return updated;
      })
    );
  };

  const handleDeleteTaxonomyGroup = (groupId: string) => {
    setTaxonomyGroups((prev) => prev.filter((g) => g.id !== groupId));
    deleteTaxonomyGroupFromFirestore(groupId);
  };

  const handleSwitchToAdmin = () => {
    const adminProfile: UserProfile = {
      uid: ADMIN_USER_UID,
      email: 'kenielcalixtonkenny@gmail.com',
      displayName: currentUser.displayName || 'Keniel Calixto',
      isAdmin: true,
    };
    upsertUserDocument(adminProfile);
    handleUserChange(adminProfile);
    setActiveRoute('admin');
  };

  const handleAddTaxonomyCategory = (groupId: string, categoryName: string) => {
    setTaxonomyGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        const newCat = {
          id: `cat_${Date.now()}`,
          groupId,
          name: categoryName,
        };
        const updated = { ...g, categories: [...g.categories, newCat] };
        saveTaxonomyGroupToFirestore(updated);
        return updated;
      })
    );
  };

  const handleUpdateTaxonomyCategory = (
    groupId: string,
    categoryId: string,
    categoryName: string
  ) => {
    setTaxonomyGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        const updated = {
          ...g,
          categories: g.categories.map((c) =>
            c.id === categoryId ? { ...c, name: categoryName } : c
          ),
        };
        saveTaxonomyGroupToFirestore(updated);
        return updated;
      })
    );
  };

  const handleDeleteTaxonomyCategory = (groupId: string, categoryId: string) => {
    setTaxonomyGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        const updated = {
          ...g,
          categories: g.categories.filter((c) => c.id !== categoryId),
        };
        saveTaxonomyGroupToFirestore(updated);
        return updated;
      })
    );
  };

  const activeWorkspace =
    workspaces.find((w) => w.id === selectedWorkspaceId) || workspaces[0];

  const isAdminUser =
    currentUser.uid === ADMIN_USER_UID || Boolean(currentUser.isAdmin);

  // =========================================================================
  // ENTRY GATE: LOGIN & ACCOUNT CREATION AS THE VERY FIRST SCREEN
  // =========================================================================
  if (!isAuthenticated) {
    return (
      <AuthScreenView
        onAuthSuccess={(profile) => {
          handleUserChange(profile);
          sessionStorage.setItem('app_aquisicoes_auth_session', 'true');
          setIsAuthenticated(true);
          setActiveRoute('dashboard');
        }}
        isDarkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode((prev) => !prev)}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors pb-20 md:pb-10">
      {/* =================================================================== */}
      {/* TOP BAR CONTRACT (3 ZONES SEPARATED BY GAP-8, NO QUADRO KANBAN)     */}
      {/* =================================================================== */}
      <header className="sticky top-0 z-30 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 px-4 sm:px-6 h-14">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="#dashboard"
            onClick={(e) => {
              e.preventDefault();
              setActiveRoute('dashboard');
            }}
            className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 font-display whitespace-nowrap shrink-0"
          >
            App de Aquisições
          </a>

          {/* Zone 2: Clean single-line navigation links */}
          <nav
            aria-label="Navegação Principal"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400"
          >
            <a
              href="#dashboard"
              onClick={(e) => {
                e.preventDefault();
                setActiveRoute('dashboard');
              }}
              className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 ${
                activeRoute === 'dashboard'
                  ? 'text-indigo-600 dark:text-indigo-400 underline underline-offset-8 decoration-2'
                  : ''
              }`}
            >
              Dashboard
            </a>
            <a
              href="#meus-espacos"
              onClick={(e) => {
                e.preventDefault();
                setActiveRoute('workspaces');
              }}
              className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 ${
                activeRoute === 'workspaces' || activeRoute === 'workspace_detail'
                  ? 'text-indigo-600 dark:text-indigo-400 underline underline-offset-8 decoration-2'
                  : ''
              }`}
            >
              Meus Espaços
            </a>
            {isAdminUser && (
              <a
                href="#ambiente-admin"
                onClick={(e) => {
                  e.preventDefault();
                  setActiveRoute('admin');
                }}
                className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 inline-flex items-center gap-1.5 ${
                  activeRoute === 'admin'
                    ? 'text-indigo-600 dark:text-indigo-400 underline underline-offset-8 decoration-2'
                    : ''
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Ambiente Admin</span>
              </a>
            )}
            <a
              href="#configuracoes"
              onClick={(e) => {
                e.preventDefault();
                setActiveRoute('settings');
              }}
              className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 inline-flex items-center gap-1.5 ${
                activeRoute === 'settings'
                  ? 'text-indigo-600 dark:text-indigo-400 underline underline-offset-8 decoration-2'
                  : ''
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>Configurações</span>
            </a>
          </nav>

          {/* Zone 3: Primary actions — Dark Mode Toggle & Logout */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsDarkMode((prev) => !prev)}
              aria-label={isDarkMode ? 'Ativar Modo Claro' : 'Ativar Modo Escuro'}
              className="min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-slate-800 text-white dark:text-slate-100 hover:bg-indigo-600 dark:hover:bg-indigo-600 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isDarkMode ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400" />
                  <span className="hidden sm:inline">Modo Claro</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-indigo-300" />
                  <span className="hidden sm:inline">Modo Escuro</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleLogout}
              title="Sair da conta e voltar para a tela de login"
              className="min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sair</span>
            </button>
          </div>
        </div>
      </header>

      {/* =================================================================== */}
      {/* MAIN CONTENT VIEWPORT                                               */}
      {/* =================================================================== */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {activeRoute === 'dashboard' && (
          <DashboardOverviewView
            workspaces={workspaces}
            lists={lists}
            items={items}
            currentUser={currentUser}
            onUpdateUserName={handleUpdateUserName}
            onSelectWorkspace={handleSelectWorkspace}
            onNavigateToWorkspaces={() => setActiveRoute('workspaces')}
            onAcceptInvitation={handleAcceptInvitation}
            onRejectInvitation={handleRejectInvitation}
          />
        )}

        {activeRoute === 'workspaces' && (
          <HubDashboardView
            workspaces={workspaces}
            lists={lists}
            items={items}
            currentUser={currentUser}
            onUpdateUserName={handleUpdateUserName}
            onSelectWorkspace={handleSelectWorkspace}
            onCreateWorkspace={handleCreateWorkspace}
            onUpdateWorkspace={handleUpdateWorkspace}
            onDeleteWorkspace={handleDeleteWorkspace}
          />
        )}

        {activeRoute === 'workspace_detail' && activeWorkspace && (
          <WorkspaceBoardView
            workspace={activeWorkspace}
            lists={lists}
            items={items}
            taxonomyGroups={taxonomyGroups}
            currentUser={currentUser}
            onBackToHub={() => setActiveRoute('workspaces')}
            onUpdateWorkspace={handleUpdateWorkspace}
            onDeleteWorkspace={handleDeleteWorkspace}
            onInviteMembers={handleInviteMembersToWorkspace}
            onUpdateMemberStatus={handleUpdateMemberStatus}
            onRemoveMember={handleRemoveMember}
            onCreateList={handleCreateList}
            onUpdateList={handleUpdateList}
            onDeleteList={handleDeleteList}
            onCreateItem={handleCreateItem}
            onUpdateItem={handleUpdateItem}
            onDeleteItem={handleDeleteItem}
            onMoveItemStage={handleMoveItemStage}
            onConfirmCartCheckout={handleConfirmCartCheckout}
            onAddGoalDeposit={handleAddGoalDeposit}
            onAddGoalQuote={handleAddGoalQuote}
            onDeleteGoalQuote={handleDeleteGoalQuote}
            onCompleteGoalAcquisition={handleCompleteGoalAcquisition}
            onConvertWishToGoal={handleConvertWishToGoal}
            onAdjustItemStock={handleAdjustItemStock}
            onReturnConfirmedToStock={handleReturnConfirmedToStock}
          />
        )}

        {activeRoute === 'admin' && isAdminUser && (
          <AdminEnvironmentView
            currentUser={currentUser}
            workspaces={workspaces}
            lists={lists}
            items={items}
            taxonomyGroups={taxonomyGroups}
            onSwitchToAdmin={handleSwitchToAdmin}
            onSelectWorkspace={handleSelectWorkspace}
            onDeleteWorkspace={handleDeleteWorkspace}
            onGrantAdminAccessToWorkspace={handleAcceptInvitation}
            onRemoteWorkspacesLoaded={(remoteWs) => {
              setWorkspaces((prev) => {
                const byId = new Map(prev.map((w) => [w.id, w]));
                remoteWs.forEach((rw) => byId.set(rw.id, rw));
                return Array.from(byId.values());
              });
            }}
          />
        )}

        {activeRoute === 'settings' && (
          <SettingsView
            groups={taxonomyGroups}
            onAddGroup={handleAddTaxonomyGroup}
            onUpdateGroup={handleUpdateTaxonomyGroup}
            onDeleteGroup={handleDeleteTaxonomyGroup}
            onAddCategory={handleAddTaxonomyCategory}
            onUpdateCategory={handleUpdateTaxonomyCategory}
            onDeleteCategory={handleDeleteTaxonomyCategory}
            currentUser={currentUser}
            onUserChange={handleUserChange}
            onLogout={handleLogout}
          />
        )}
      </main>

      {/* =================================================================== */}
      {/* MOBILE FIXED BOTTOM TAB BAR (< md)                                  */}
      {/* =================================================================== */}
      <nav
        aria-label="Navegação Mobile"
        className={`md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid ${
          isAdminUser ? 'grid-cols-4' : 'grid-cols-3'
        } items-center h-14 px-2`}
      >
        <button
          type="button"
          onClick={() => setActiveRoute('dashboard')}
          className={`flex flex-col items-center justify-center h-full text-[11px] font-medium transition-colors ${
            activeRoute === 'dashboard'
              ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <LayoutDashboard className="w-4 h-4" />
          <span className="mt-0.5">Dashboard</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveRoute('workspaces')}
          className={`flex flex-col items-center justify-center h-full text-[11px] font-medium transition-colors ${
            activeRoute === 'workspaces' || activeRoute === 'workspace_detail'
              ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <FolderKanban className="w-4 h-4" />
          <span className="mt-0.5">Meus Espaços</span>
        </button>

        {isAdminUser && (
          <button
            type="button"
            onClick={() => setActiveRoute('admin')}
            className={`flex flex-col items-center justify-center h-full text-[11px] font-medium transition-colors ${
              activeRoute === 'admin'
                ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span className="mt-0.5">Admin</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveRoute('settings')}
          className={`flex flex-col items-center justify-center h-full text-[11px] font-medium transition-colors ${
            activeRoute === 'settings'
              ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span className="mt-0.5">Configurações</span>
        </button>
      </nav>
    </div>
  );
}
