export interface User {
    id: string;
    name: string;
    avatar?: string | null;
    color?: string;
}

export interface Split {
    userId: string;
    amount: number; // Share of the expense
}

export interface ReceiptItem {
    description: string;
    quantity: number;
    price: number;
    total: number;
}

export interface Expense {
    id: string;
    description: string;
    amount: number;
    paidBy: string;
    date: string;
    category: string;
    receiptUrl?: string | null;
    receiptData?: ReceiptItem[];
    splits: Split[];
}

export interface Balance {
    fromUser: string;
    toUser: string;
    amount: number;
}
