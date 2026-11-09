import sys,tempfile,unittest,uuid
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from workspace_files import workspace_files

class SharedStorageFiles(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve()
    def tearDown(self): self.temp.cleanup()
    def call(self,operation,**args): return workspace_files(self.root,operation,dict(args,strictLinks=True))
    def test_versions_listing_and_conditional_replace(self):
        self.call('mkdir',path='资料');self.call('write',path='资料/Notes.txt',content='Original',create=True)
        info=self.call('copy-info',path='资料/Notes.txt');listing=self.call('shared-list')
        self.assertEqual(listing['entries'][0]['version'],info['version'])
        stage='.agents-transfer-'+str(uuid.uuid4());(self.root/stage).mkdir();(self.root/stage/'payload').write_text('Revised',encoding='utf-8')
        with self.assertRaises(ValueError): self.call('copy-replace',path=stage+'/payload',to='资料/Notes.txt',expectedVersion='stale')
        self.assertEqual((self.root/'资料/Notes.txt').read_text(),'Original')
        self.call('copy-replace',path=stage+'/payload',to='资料/Notes.txt',expectedVersion=info['version'])
        self.assertEqual((self.root/'资料/Notes.txt').read_text(),'Revised')
    def test_recoverable_receipts_and_rollback(self):
        file=self.root/'Paper.pdf';file.write_bytes(b'%PDF-fixture');version=self.call('copy-info',path=file.name)['version']
        with self.assertRaises(ValueError): self.call('trash',path=file.name,expectedVersion='stale')
        self.assertTrue(file.exists())
        deleted=self.call('trash',path=file.name,expectedVersion=version,by={'kind':'agent','employeeId':'one'})
        self.assertEqual(self.call('shared-list')['trash'][0]['by']['employeeId'],'one')
        self.call('restore',id=deleted['id'],keepReceipt=True)
        self.assertTrue(self.call('trash-info',id=deleted['id'])['already'])
        self.call('restore-rollback',id=deleted['id'])
        self.assertFalse(file.exists());self.assertTrue(self.call('trash-info',id=deleted['id'])['available'])
        self.call('restore',id=deleted['id'],keepReceipt=True);file.write_bytes(b'User edit')
        with self.assertRaises(ValueError): self.call('restore-rollback',id=deleted['id'])
        self.assertEqual(file.read_bytes(),b'User edit')
    def test_failed_metadata_never_loses_a_recoverable_file(self):
        file=self.root/'Paper.pdf';file.write_bytes(b'Original')
        with patch('workspace_files.os.fsync',side_effect=OSError('disk full')):
            with self.assertRaises(OSError): self.call('trash',path=file.name)
        self.assertEqual(file.read_bytes(),b'Original')
        deleted=self.call('trash',path=file.name)
        with patch('workspace_files.os.fsync',side_effect=OSError('disk full')):
            with self.assertRaises(OSError): self.call('restore',id=deleted['id'],keepReceipt=True)
        self.assertFalse(file.exists());self.assertEqual(len(self.call('shared-list')['trash']),1)
        with patch('workspace_files.os.fsync',side_effect=[None,OSError('second receipt failed')]):
            with self.assertRaises(OSError): self.call('restore',id=deleted['id'],keepReceipt=True)
        self.assertFalse(file.exists());self.assertEqual(len(self.call('shared-list')['trash']),1)
        self.call('restore',id=deleted['id'],keepReceipt=True);self.assertEqual(file.read_bytes(),b'Original')
    def test_links_and_traversal_reject(self):
        (self.root/'Data.txt').write_text('Original');(self.root/'Alias').symlink_to('Data.txt')
        with self.assertRaises(ValueError): self.call('copy-read',path='Alias',offset=0,length=10)
        with self.assertRaises(ValueError): self.call('copy-info',path='../outside')
        self.assertEqual(len(self.call('shared-list')['entries']),1)

if __name__=='__main__': unittest.main()
