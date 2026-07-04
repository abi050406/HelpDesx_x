import axios from 'axios';
import { PUSH_API_URL } from '../config/api';

function decodeKey(value) { const padding = '='.repeat((4-value.length%4)%4); const raw=atob((value+padding).replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from([...raw].map((c)=>c.charCodeAt(0))); }
export async function subscribeToPush(token) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (await Notification.requestPermission() !== 'granted') return false;
  const registration=await navigator.serviceWorker.register('/sw.js');
  const key=await axios.get(`${PUSH_API_URL}/public-key`,{headers:{Authorization:`Bearer ${token}`}});
  const subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeKey(key.data.publicKey)});
  await axios.post(`${PUSH_API_URL}/subscriptions`,subscription.toJSON(),{headers:{Authorization:`Bearer ${token}`}}); return true;
}
