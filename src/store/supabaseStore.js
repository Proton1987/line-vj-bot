const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('[store] ⚠️ SUPABASE_URL หรือ SUPABASE_KEY ไม่ได้ถูกตั้งค่า');
}

const supabase = createClient(supabaseUrl || '', supabaseKey || '');

// --- Orders Store ---
async function saveOrder(orderData) {
  const { data, error } = await supabase
    .from('orders')
    .upsert({
      id: orderData.id,
      user_id: orderData.userId,
      display_name: orderData.displayName,
      hours: orderData.hours,
      amount: orderData.amount,
      slip_url: orderData.slipUrl,
      status: orderData.status || 'pending',
      updated_at: new Date()
    })
    .select();

  if (error) {
    console.error('[store] Error saving order:', error);
    throw error;
  }
  return data[0];
}

async function getOrder(orderId) {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[store] Error fetching order:', error);
  }
  return data || null;
}

// --- Customers Store ---
async function getCustomer(userId) {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[store] Error fetching customer:', error);
  }
  return data || null;
}

async function saveCustomer(customerData) {
  const { data, error } = await supabase
    .from('customers')
    .upsert({
      user_id: customerData.userId,
      display_name: customerData.displayName,
      approved: customerData.approved,
      hourly_rate: customerData.hourlyRate,
      package_hours: customerData.packageHours,
      package_price: customerData.packagePrice,
      updated_at: new Date()
    })
    .select();

  if (error) {
    console.error('[store] Error saving customer:', error);
    throw error;
  }
  return data[0];
}

module.exports = {
  saveOrder,
  getOrder,
  getCustomer,
  saveCustomer,
  supabase
};