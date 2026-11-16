import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
    apiKey: "AIzaSyCWEc9HcbWukArffEuL9cyE2o8dV0VVmPw",
    authDomain: "smart-rosary-78b57.firebaseapp.com",
    projectId: "smart-rosary-78b57",
    storageBucket: "smart-rosary-78b57.firebasestorage.app",
    messagingSenderId: "167485172201",
    appId: "1:167485172201:web:c4df4fa8f83c93d29b0378",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);