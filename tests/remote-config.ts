export function required(name:string):string {
  const value=process.env[name];
  if(!value?.trim())throw new Error('Set '+name+' for remote acceptance tests');
  return value;
}
export const workerBase=()=>required('HUAJIBOT_TEST_WORKER_URL').replace(/\/$/,'');
export function destination(group?:string) {
  return {bridgeInstance:process.env.HUAJIBOT_TEST_BRIDGE_INSTANCE??'main',robotId:required('HUAJIBOT_TEST_ROBOT_ID'),groupId:group??required('HUAJIBOT_TEST_GROUP_ID')};
}
export function queueBase():string {
  const account=required('HUAJIBOT_TEST_ACCOUNT_ID'),queue=required('HUAJIBOT_TEST_QUEUE_ID');
  if(!/^[a-f0-9]{32}$/.test(account)||!/^[a-f0-9]{32}$/.test(queue))throw new Error('Invalid test resource IDs');
  return `https://api.cloudflare.com/client/v4/accounts/${account}/queues/${queue}/messages/`;
}
