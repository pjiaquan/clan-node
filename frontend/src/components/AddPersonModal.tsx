import React from 'react';

interface AddPersonModalProps {
  onClose: () => void;
  onSubmit: (name: string, gender: 'M' | 'F' | 'O') => void;
}

export const AddPersonModal: React.FC<AddPersonModalProps> = ({ onClose, onSubmit }) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>新增成員</h2>
        <form onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          onSubmit(
            formData.get('name') as string,
            formData.get('gender') as 'M' | 'F' | 'O'
          );
        }}>
          <div className="form-group">
            <label>姓名</label>
            <input name="name" required autoFocus />
          </div>
          <div className="form-group">
            <label>性別</label>
            <select name="gender" defaultValue="O">
              <option value="M">男</option>
              <option value="F">女</option>
              <option value="O">其他</option>
            </select>
          </div>
          <div className="form-actions">
            <button type="button" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn-primary">
              新增
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
