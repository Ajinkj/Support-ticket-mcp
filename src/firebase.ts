import { FirebaseApp, initializeApp } from "firebase/app";
import { 
  Firestore,
  getFirestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where,
  setDoc,
  updateDoc,
  arrayUnion,
  Timestamp,
  orderBy,
  limit
} from "firebase/firestore/lite";
import { TicketData, InvestigationEntry, KBData } from "./types";

let app: FirebaseApp | null = null;
let db: Firestore;

export function initFirebase(env: Record<string, string>) {
  if (!app) {
    app = initializeApp({
      apiKey: env.FIREBASE_API_KEY,
      authDomain: env.FIREBASE_AUTH_DOMAIN,
      projectId: env.FIREBASE_PROJECT_ID,
      storageBucket: env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
      appId: env.FIREBASE_APP_ID
    });
    db = getFirestore(app);
  }
}


// Helper function to tokenize string for basic keyword search
function tokenize(text: string): string[] {
  if (!text) return [];
  return text.toLowerCase().split(/\W+/).filter(word => word.length > 2);
}

export const firebaseApi = {
  async getTicket(id: string): Promise<TicketData | null> {
    const docRef = doc(db, "tickets", id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return { ...(docSnap.data() as TicketData), id: docSnap.id };
    }
    return null;
  },

  async searchSimilarTickets(searchTerm: string): Promise<TicketData[]> {
    // In a real prod setup without algolia/elastic, you'd use a dedicated search service.
    // Here we will use a basic keyword search if tickets have a 'keywords' array, 
    // or we fetch recent resolved tickets and filter in memory for testing purposes.
    const ticketsRef = collection(db, "tickets");
    // Fetch recent tickets to find similar contexts, regardless of status
    const q = query(ticketsRef, limit(50));
    const snapshot = await getDocs(q);
    
    const searchTokens = tokenize(searchTerm);
    const results: TicketData[] = [];
    
    snapshot.forEach(docSnap => {
      const data = docSnap.data() as TicketData;
      const content = `${data.title} ${data.supportDescription || ""} ${data.customerDescription || ""}`.toLowerCase();
      
      // Simple relevance scoring: count how many search tokens match
      let score = 0;
      for (const token of searchTokens) {
        if (content.includes(token)) score++;
      }
      
      if (score > 0) {
        results.push({ ...data, id: docSnap.id });
      }
    });
    
    // Sort by most matching tokens
    return results.sort((a, b) => {
      const scoreA = searchTokens.filter(t => `${a.title} ${a.supportDescription}`.toLowerCase().includes(t)).length;
      const scoreB = searchTokens.filter(t => `${b.title} ${b.supportDescription}`.toLowerCase().includes(t)).length;
      return scoreB - scoreA;
    }).slice(0, 5); // Return top 5
  },

  async searchKB(searchTerm: string): Promise<KBData[]> {
    const kbRef = collection(db, "knowledgeBase");
    // Assuming KB is relatively small, we fetch all or recent and filter in memory.
    // For scale, Firebase recommends Algolia or similar.
    const q = query(kbRef, limit(100));
    const snapshot = await getDocs(q);
    
    const searchTokens = tokenize(searchTerm);
    const results: KBData[] = [];
    
    snapshot.forEach(docSnap => {
      const data = docSnap.data() as KBData;
      const content = `${data.subject} ${data.content} ${data.resolution || ""}`.toLowerCase();
      
      let score = 0;
      for (const token of searchTokens) {
        if (content.includes(token)) score++;
      }
      
      if (score > 0) {
        results.push({ ...data, id: docSnap.id });
      }
    });

    return results.sort((a, b) => {
      const scoreA = searchTokens.filter(t => `${a.subject} ${a.content}`.toLowerCase().includes(t)).length;
      const scoreB = searchTokens.filter(t => `${b.subject} ${b.content}`.toLowerCase().includes(t)).length;
      return scoreB - scoreA;
    }).slice(0, 5);
  },

  async addInvestigationLog(ticketId: string, entry: InvestigationEntry): Promise<void> {
    const ticketRef = doc(db, "tickets", ticketId);
    await updateDoc(ticketRef, {
      investigationLog: arrayUnion(entry),
      lastModified: new Date().toISOString()
    });
  },

  async createTicket(ticketData: Omit<TicketData, 'id' | 'createdAt' | 'lastModified' | 'investigationLog' | 'status' | 'assignedUsers'> & { customerEmail: string }): Promise<TicketData> {
    const tNumber = ticketData.ticketNumber;
    const newTicket: any = {
      ...ticketData,
      status: 'Open',
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      investigationLog: [],
      assignedUsers: []
    };
    
    // Remove undefined values
    Object.keys(newTicket).forEach(key => newTicket[key] === undefined && delete newTicket[key]);

    // Use setDoc to explicitly set the document ID to match the ticketNumber
    const docRef = doc(db, "tickets", tNumber);
    await setDoc(docRef, newTicket);
    return { id: tNumber, ...newTicket };
  },

  async createKBEntry(kbData: Omit<KBData, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<KBData> {
    const docId = kbData.id || `KB-${Math.floor(Math.random() * 1000000)}`;
    const newKB: any = {
      ...kbData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    // Remove undefined values
    Object.keys(newKB).forEach(key => newKB[key] === undefined && delete newKB[key]);

    const docRef = doc(db, "knowledgeBase", docId);
    await setDoc(docRef, newKB);
    return { id: docId, ...newKB };
  },

  async listAllTickets(): Promise<Array<{ id: string; ticketNumber: string; title: string; supportDescription?: string }>> {
    const ticketsRef = collection(db, "tickets");
    const q = query(ticketsRef, limit(100)); // Limit to 100 for safety
    const snapshot = await getDocs(q);
    
    const results: Array<{ id: string; ticketNumber: string; title: string; supportDescription?: string }> = [];
    snapshot.forEach(docSnap => {
      const data = docSnap.data() as TicketData;
      results.push({
        id: docSnap.id,
        ticketNumber: data.ticketNumber,
        title: data.title,
        supportDescription: data.supportDescription
      });
    });
    return results;
  }
};
