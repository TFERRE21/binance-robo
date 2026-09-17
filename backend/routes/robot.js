const express = require('express');
const authMiddleware = require('../middleware/auth');
const engine = require('../services/robotEngine');

const router = express.Router();

function bodyConfig(body){
  const allowed=['basico','medio','premium','avancado','elite','v7.1','v6'];
  const rawStrategy=String(body.strategyVersion||'premium');
  const legacyMap={'v7.1':'premium','v6':'medio'};
  const strategyVersion=allowed.includes(rawStrategy)?(legacyMap[rawStrategy]||rawStrategy):'premium';
  const entryPercent=Number(body.entryPercent);
  const takeProfit=Number(body.takeProfit);
  const stopLoss=Number(body.stopLoss);
  const maxOperations=Number(body.maxOperations);
  const maxCoins=Number(body.maxCoins);
  const interval=['1m','5m','15m','30m','1h'].includes(String(body.interval))?String(body.interval):'15m';
  const stopLossActive=body.stopLossActive!==false;
  if(!Number.isFinite(entryPercent)||entryPercent<=0||entryPercent>100)throw new Error('A entrada deve estar entre 0 e 100%.');
  if(!Number.isFinite(takeProfit)||takeProfit<=0||takeProfit>100)throw new Error('Take Profit inválido.');
  if(!Number.isFinite(stopLoss)||stopLoss<=0||stopLoss>100)throw new Error('Stop Loss inválido.');
  if(!Number.isInteger(maxOperations)||maxOperations<1||maxOperations>3)throw new Error('O Premium permite de 1 a 3 operações simultâneas.');
  if(!Number.isInteger(maxCoins)||maxCoins<1||maxCoins>50)throw new Error('O máximo de moedas deve ficar entre 1 e 50.');
  return {strategyVersion,entryPercent,takeProfit,stopLoss,stopLossActive,maxOperations,interval,maxCoins};
}

router.get('/status',authMiddleware,async(req,res)=>{
  try{const accountId=String(req.query.account||''); if(!accountId)return res.status(400).json({success:false,message:'Informe a conta Binance.'}); return res.json(await engine.getStatus(req.user.id,accountId));}
  catch(e){console.error('ROBOT STATUS:',e);return res.status(500).json({success:false,message:e.message||'Não foi possível consultar o robô.'});}
});

router.post('/config',authMiddleware,async(req,res)=>{
  try{const accountId=String(req.body.accountId||''); if(!accountId)return res.status(400).json({success:false,message:'Selecione uma conta Binance.'}); const c=bodyConfig(req.body); const saved=await engine.saveConfig(req.user.id,accountId,c); return res.json({success:true,message:'Configuração salva no servidor.',config:saved,configId:saved.id||null});}
  catch(e){console.error('ROBOT CONFIG:',e);return res.status(400).json({success:false,message:e.message||'Não foi possível salvar a configuração.'});}
});

router.post('/start',authMiddleware,async(req,res)=>{
  try{const accountId=String(req.body.accountId||''); if(!accountId)return res.status(400).json({success:false,message:'Selecione uma conta Binance.'}); const result=await engine.start(req.user.id,accountId); return res.json({success:true,message:'Robô iniciado para esta conta.',...result});}
  catch(e){console.error('ROBOT START:',e);return res.status(400).json({success:false,message:e.message||'Não foi possível iniciar o robô.'});}
});

router.post('/stop',authMiddleware,async(req,res)=>{
  try{const accountId=String(req.body.accountId||''); if(!accountId)return res.status(400).json({success:false,message:'Selecione uma conta Binance.'}); const result=await engine.stop(req.user.id,accountId); return res.json({success:true,message:'Robô parado. Ordens já existentes não são canceladas automaticamente.',...result});}
  catch(e){console.error('ROBOT STOP:',e);return res.status(400).json({success:false,message:e.message||'Não foi possível parar o robô.'});}
});

module.exports=router;
