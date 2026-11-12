import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isTokenValid, handleAuthError } from '../utils/auth';

const ProtectedRoute = ({ children, allowedRole }) => {
  const navigate = useNavigate();
  const tokenValid = isTokenValid();
  const currentRole = localStorage.getItem('role');
  const roleAllowed = !allowedRole || currentRole === allowedRole;

  useEffect(() => {
    if (!tokenValid) {
      handleAuthError(navigate);
    } else if (!roleAllowed) {
      navigate('/', { replace: true });
    }
  }, [navigate, tokenValid, roleAllowed]);

  return tokenValid && roleAllowed ? children : null;
};

export default ProtectedRoute;
