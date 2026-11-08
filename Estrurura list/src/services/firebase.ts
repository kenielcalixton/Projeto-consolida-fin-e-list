import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
} from 'firebase/storage';
import {
  AcquisitionItem,
  AcquisitionList,
  ProductPurchase,
  TaxonomyGroup,
  UserProfile,
  Workspace,
} from '../types';

/**
 * ============================================================================
 * CONFIGURAÇÃO DO FIREBASE (PROJETO: app-de-aquiscao---beta-teste)
 * ============================================================================
 */
export const ADMIN_USER_UID = 'wAUPqTjSmOMV3S8XlaLlv46QK463';

export const firebaseConfig = {
  apiKey: 'AIzaSyBSFUUdHBtmOpmCSqcry4vV13LQ8tZA5NM',
  authDomain: 'app-de-aquiscao---beta-teste.firebaseapp.com',
  databaseURL: 'https://app-de-aquiscao---beta-teste-default-rtdb.firebaseio.com',
  projectId: 'app-de-aquiscao---beta-teste',
  storageBucket: 'app-de-aquiscao---beta-teste.firebasestorage.app',
  messagingSenderId: '1042037519777',
  appId: '1:1042037519777:web:70cc22ed7d0fda8b7087e0',
};

// Initialize Firebase App, Auth, Firestore, and Storage
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// ============================================================================
// 1. AUTENTICAÇÃO (FIREBASE AUTH - LOGIN, CRIAÇÃO DE CONTA E SENHA)
// ============================================================================

export async function loginWithEmail(email: string, password: string): Promise<UserProfile> {
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  const profile = mapFirebaseUserToProfile(credential.user);
  await upsertUserDocument(profile);
  return profile;
}

export async function registerWithEmail(
  name: string,
  email: string,
  password: string
): Promise<UserProfile> {
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (name.trim()) {
    await updateProfile(credential.user, { displayName: name.trim() });
  }
  const profile: UserProfile = {
    uid: credential.user.uid,
    email: credential.user.email || email.trim(),
    displayName: name.trim() || email.split('@')[0],
    isAdmin: credential.user.uid === ADMIN_USER_UID,
  };
  await upsertUserDocument(profile);
  return profile;
}

export async function resetPasswordWithEmail(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export async function logoutFirebase(): Promise<void> {
  await firebaseSignOut(auth);
}

export function subscribeToAuthChanges(callback: (user: UserProfile | null) => void) {
  return onAuthStateChanged(auth, (firebaseUser) => {
    if (!firebaseUser) {
      callback(null);
      return;
    }
    callback(mapFirebaseUserToProfile(firebaseUser));
  });
}

function mapFirebaseUserToProfile(user: User): UserProfile {
  return {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || user.email?.split('@')[0] || 'Usuário',
    avatarUrl: user.photoURL || undefined,
    isAdmin: user.uid === ADMIN_USER_UID,
  };
}

// ============================================================================
// 2. COLEÇÃO `users` & FUNÇÕES DO AMBIENTE ADMIN
// ============================================================================

export async function upsertUserDocument(user: UserProfile): Promise<void> {
  try {
    const userRef = doc(db, 'users', user.uid);
    await setDoc(
      userRef,
      {
        uid: user.uid,
        email: user.email.toLowerCase(),
        displayName: user.displayName,
        avatarUrl: user.avatarUrl || null,
        isAdmin: user.uid === ADMIN_USER_UID || Boolean(user.isAdmin),
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('[Firestore / Offline fallback] upsertUserDocument:', err);
  }
}

export async function fetchAllUsersFromFirestore(): Promise<UserProfile[]> {
  try {
    const usersRef = collection(db, 'users');
    const snapshot = await getDocs(usersRef);
    return snapshot.docs.map((d) => {
      const data = d.data();
      return {
        uid: data.uid || d.id,
        email: data.email || '',
        displayName: data.displayName || 'Usuário',
        avatarUrl: data.avatarUrl || undefined,
        isAdmin: data.uid === ADMIN_USER_UID || d.id === ADMIN_USER_UID || Boolean(data.isAdmin),
      };
    });
  } catch {
    return [];
  }
}

export async function fetchAllWorkspacesFromFirestore(): Promise<Workspace[]> {
  try {
    const workspacesRef = collection(db, 'workspaces');
    const snapshot = await getDocs(workspacesRef);
    return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Workspace, 'id'>) }));
  } catch {
    return [];
  }
}

export async function syncAllDataToFirestore(payload: {
  users: UserProfile[];
  workspaces: Workspace[];
  lists: AcquisitionList[];
  items: AcquisitionItem[];
  taxonomyGroups: TaxonomyGroup[];
}): Promise<{ syncedCount: number }> {
  let syncedCount = 0;

  for (const u of payload.users) {
    await upsertUserDocument(u);
    syncedCount++;
  }
  for (const g of payload.taxonomyGroups) {
    await saveTaxonomyGroupToFirestore(g);
    syncedCount++;
  }
  for (const w of payload.workspaces) {
    await saveWorkspaceToFirestore(w);
    syncedCount++;
  }
  for (const l of payload.lists) {
    await saveListToFirestore(l);
    syncedCount++;
  }
  for (const i of payload.items) {
    await saveItemToFirestore(i);
    syncedCount++;
  }

  return { syncedCount };
}

// ============================================================================
// 3. COLEÇÃO `workspaces`
// ============================================================================

export async function fetchAcceptedWorkspacesFromFirestore(
  userEmail: string
): Promise<Workspace[]> {
  const normalizedEmail = userEmail.trim().toLowerCase();
  const workspacesRef = collection(db, 'workspaces');
  const aclQuery = query(
    workspacesRef,
    where('acceptedMemberEmails', 'array-contains', normalizedEmail)
  );
  const snapshot = await getDocs(aclQuery);
  return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Workspace, 'id'>) }));
}

export async function saveWorkspaceToFirestore(workspace: Workspace): Promise<void> {
  try {
    const wsRef = doc(db, 'workspaces', workspace.id);
    await setDoc(wsRef, workspace, { merge: true });
  } catch (err) {
    console.warn('[Firestore / Offline fallback] saveWorkspaceToFirestore:', err);
  }
}

export async function deleteWorkspaceFromFirestore(workspaceId: string): Promise<void> {
  try {
    const wsRef = doc(db, 'workspaces', workspaceId);
    await deleteDoc(wsRef);
  } catch (err) {
    console.warn('[Firestore / Offline fallback] deleteWorkspaceFromFirestore:', err);
  }
}

// ============================================================================
// 4. COLEÇÃO `lists`
// ============================================================================

export async function fetchListsForWorkspaceFromFirestore(
  workspaceId: string,
  userEmail: string
): Promise<AcquisitionList[]> {
  const normalizedEmail = userEmail.trim().toLowerCase();
  const listsRef = collection(db, 'lists');
  const aclQuery = query(
    listsRef,
    where('workspaceId', '==', workspaceId),
    where('acceptedMemberEmails', 'array-contains', normalizedEmail)
  );
  const snapshot = await getDocs(aclQuery);
  return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AcquisitionList, 'id'>) }));
}

export async function saveListToFirestore(list: AcquisitionList): Promise<void> {
  try {
    const listRef = doc(db, 'lists', list.id);
    await setDoc(listRef, list, { merge: true });
  } catch (err) {
    console.warn('[Firestore / Offline fallback] saveListToFirestore:', err);
  }
}

export async function deleteListFromFirestore(listId: string): Promise<void> {
  try {
    const listRef = doc(db, 'lists', listId);
    await deleteDoc(listRef);
  } catch (err) {
    console.warn('[Firestore / Offline fallback] deleteListFromFirestore:', err);
  }
}

// ============================================================================
// 5. COLEÇÃO `items` E SUBCOLEÇÃO `items/{itemId}/products` (HISTÓRICO)
// ============================================================================

export async function fetchItemsForWorkspaceFromFirestore(
  workspaceId: string,
  userEmail: string
): Promise<AcquisitionItem[]> {
  const normalizedEmail = userEmail.trim().toLowerCase();
  const itemsRef = collection(db, 'items');
  const aclQuery = query(
    itemsRef,
    where('workspaceId', '==', workspaceId),
    where('acceptedMemberEmails', 'array-contains', normalizedEmail)
  );
  const snapshot = await getDocs(aclQuery);

  const items: AcquisitionItem[] = [];
  for (const itemDoc of snapshot.docs) {
    const itemData = { id: itemDoc.id, ...(itemDoc.data() as Omit<AcquisitionItem, 'id'>) };
    try {
      const productsSubRef = collection(db, 'items', itemDoc.id, 'products');
      const prodQuery = query(productsSubRef, orderBy('purchaseDate', 'desc'));
      const prodSnap = await getDocs(prodQuery);
      if (!prodSnap.empty) {
        itemData.productsHistory = prodSnap.docs.map((p) => ({
          id: p.id,
          ...(p.data() as Omit<ProductPurchase, 'id'>),
        }));
      }
    } catch {
      // Fallback caso o índice composto ainda não esteja criado
    }
    items.push(itemData);
  }
  return items;
}

export async function saveItemToFirestore(item: AcquisitionItem): Promise<void> {
  try {
    const itemRef = doc(db, 'items', item.id);
    await setDoc(itemRef, item, { merge: true });
  } catch (err) {
    console.warn('[Firestore / Offline fallback] saveItemToFirestore:', err);
  }
}

export async function recordProductInSubcollection(
  item: AcquisitionItem,
  product: ProductPurchase
): Promise<void> {
  try {
    const productRef = doc(db, 'items', item.id, 'products', product.id);
    await setDoc(productRef, product);
    const itemRef = doc(db, 'items', item.id);
    await updateDoc(itemRef, {
      stage: item.stage,
      currentStock: item.currentStock ?? 0,
      cartDraft: item.cartDraft ?? null,
      productsHistory: item.productsHistory,
      updatedAt: item.updatedAt,
    });
  } catch (err) {
    console.warn('[Firestore / Offline fallback] recordProductInSubcollection:', err);
  }
}

export async function deleteItemFromFirestore(itemId: string): Promise<void> {
  try {
    const itemRef = doc(db, 'items', itemId);
    await deleteDoc(itemRef);
  } catch (err) {
    console.warn('[Firestore / Offline fallback] deleteItemFromFirestore:', err);
  }
}

// ============================================================================
// 6. CATEGORIAS E SUBCATEGORIAS (`taxonomy`)
// ============================================================================

export async function saveTaxonomyGroupToFirestore(group: TaxonomyGroup): Promise<void> {
  try {
    const groupRef = doc(db, 'taxonomy', group.id);
    await setDoc(groupRef, group, { merge: true });
  } catch (err) {
    console.warn('[Firestore / Offline fallback] saveTaxonomyGroupToFirestore:', err);
  }
}

export async function deleteTaxonomyGroupFromFirestore(groupId: string): Promise<void> {
  try {
    const groupRef = doc(db, 'taxonomy', groupId);
    await deleteDoc(groupRef);
  } catch (err) {
    console.warn('[Firestore / Offline fallback] deleteTaxonomyGroupFromFirestore:', err);
  }
}

// ============================================================================
// 7. ARMAZENAMENTO (FIREBASE STORAGE - RECIBOS, FOTOS E AVATARES)
// ============================================================================

export async function uploadFileToFirebaseStorage(
  file: File,
  folder: 'receipts' | 'products' | 'avatars',
  ownerId: string
): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${folder}/${ownerId}/${Date.now()}_${safeName}`;
  try {
    const storageRef = ref(storage, storagePath);
    const snapshot = await uploadBytes(storageRef, file);
    const downloadUrl = await getDownloadURL(snapshot.ref);
    return downloadUrl;
  } catch (err) {
    console.warn(
      '[Firebase Storage] Usando DataURL local para visualização imediata:',
      err
    );
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
  }
}
