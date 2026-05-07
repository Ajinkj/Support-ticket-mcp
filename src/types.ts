export interface UserData {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  isAdmin: boolean;
}

export interface TicketData {
  id: string;
  ticketNumber: string;
  title: string;
  supportDescription?: string;
  customerDescription?: string;
  status: 'Open' | 'InProgress' | 'Pending' | 'Resolved' | 'Closed';
  businessImpact: 'Low' | 'Medium' | 'High' | 'Critical';
  category: string;
  assignedTo?: string;
  assignedUsers: string[];
  supportingLinks: string[];
  createdAt: string;
  lastModified: string;
  investigationLog: InvestigationEntry[];
}

export interface InvestigationEntry {
  type: string;
  description: string;
  timestamp: string;
  userId: string;
}

export interface KBData {
  id: string;
  subject: string;
  content: string;
  resolution?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
