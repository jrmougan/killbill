export interface User {
    id: string;
    name: string;
    avatar?: string; // Emoji or URL
    color: string; // Hex for avatar bg
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
    paidBy: string; // UserId
    date: string; // ISO date
    category: "food" | "transport" | "utilities" | "entertainment" | "rent" | "shopping" | "other";
    receiptUrl?: string;
    receiptData?: ReceiptItem[];
    splits: Split[]; // Who is this for?
}

export interface Balance {
    fromUser: string;
    toUser: string;
    amount: number;
}
